// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC8183} from "erc8183/ERC8183.sol";
import {MockERC20} from "solmate/test/utils/mocks/MockERC20.sol";

/// @notice L-018 — the deploy wiring DeployAgenticCommerce.s.sol produces,
///         exercised through the lifecycle the server drives (agent-commerce.ts):
///         client createJob → provider setBudget → client approve + fund →
///         provider submit → evaluator complete → provider paid. Pins the two
///         things the deploy can get wrong: the payment-token allowlist and the
///         admin role on the proxy.
contract AgenticCommerceDeployTest is Test {
    ERC8183 internal commerce;
    MockERC20 internal usdc;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal client = makeAddr("client");
    address internal provider = makeAddr("provider");
    address internal evaluator = makeAddr("evaluator");

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC", 6);
        // ── DeployAgenticCommerce.s.sol, mirrored ──
        ERC8183 impl = new ERC8183();
        bytes memory init = abi.encodeCall(ERC8183.initialize, (treasury, admin));
        commerce = ERC8183(address(new ERC1967Proxy(address(impl), init)));
        vm.prank(admin);
        commerce.setPaymentTokenAllowed(address(usdc), true);
        usdc.mint(client, 1000e6);
    }

    function test_deployWiring() public view {
        assertEq(commerce.platformTreasury(), treasury);
        assertTrue(commerce.hasRole(commerce.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(commerce.hasRole(commerce.ADMIN_ROLE(), admin));
        assertTrue(commerce.allowedPaymentTokens(address(usdc)));
        assertEq(commerce.jobCounter(), 0);
    }

    function test_budgetRefusesAnUnlistedToken() public {
        MockERC20 other = new MockERC20("X", "X", 18);
        uint256 jobId = _createJob();
        vm.prank(provider);
        vm.expectRevert(ERC8183.PaymentTokenNotAllowed.selector);
        commerce.setBudget(jobId, address(other), 1e18, "");
    }

    function test_lifecycle_createBudgetFundSubmitComplete() public {
        uint256 jobId = _createJob();
        // The server derives the new id as jobCounter after the receipt.
        assertEq(jobId, commerce.jobCounter());
        assertEq(jobId, 1);

        vm.prank(provider);
        commerce.setBudget(jobId, address(usdc), 250e6, "");
        ERC8183.Job memory job = commerce.getJob(jobId);
        assertEq(job.paymentToken, address(usdc));
        assertEq(job.budget, 250e6);

        // fund_job: approve, then fund with the stored token + budget echoed back.
        vm.startPrank(client);
        usdc.approve(address(commerce), 250e6);
        commerce.fund(jobId, address(usdc), 250e6, "");
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(commerce)), 250e6, "escrowed");
        assertEq(uint8(commerce.getJob(jobId).status), uint8(ERC8183.JobStatus.Funded));

        vm.prank(provider);
        commerce.submit(jobId, keccak256("deliverable"), "");

        vm.prank(evaluator);
        commerce.complete(jobId, bytes32("ok"), "");
        assertEq(uint8(commerce.getJob(jobId).status), uint8(ERC8183.JobStatus.Completed));
        assertEq(usdc.balanceOf(provider), 250e6, "provider paid in full (0 bp fees)");
        assertEq(usdc.balanceOf(address(commerce)), 0, "escrow emptied");
    }

    function test_fundRejectsAStaleBudgetEcho() public {
        uint256 jobId = _createJob();
        vm.prank(provider);
        commerce.setBudget(jobId, address(usdc), 250e6, "");
        vm.startPrank(client);
        usdc.approve(address(commerce), 250e6);
        vm.expectRevert(ERC8183.BudgetMismatch.selector);
        commerce.fund(jobId, address(usdc), 200e6, "");
        vm.stopPrank();
    }

    function _createJob() internal returns (uint256) {
        vm.prank(client);
        return commerce.createJob(provider, evaluator, uint48(block.timestamp + 7 days), "analysis", address(0), 0);
    }
}
