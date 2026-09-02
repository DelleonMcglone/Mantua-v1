import { env } from "../env.ts";
import { logger } from "./logger.ts";

/**
 * Uniswap v4 Base subgraph client (The Graph decentralized network).
 *
 * The official subgraph schema is intentionally minimal: a Position only
 * exposes id/tokenId/owner/origin/createdAtTimestamp. Full position state
 * (ticks, liquidity, poolKey) requires on-chain enrichment via
 * PositionManager view calls — see external-positions.ts.
 */

export interface SubgraphPosition {
  tokenId: string;
  owner: string;
  origin: string;
  createdAtTimestamp: string;
}

interface PositionsResponse {
  data?: { positions?: Array<SubgraphPosition> };
  errors?: Array<{ message: string }>;
}

const POSITIONS_BY_OWNER_QUERY = `
  query PositionsByOwner($owner: String!, $first: Int!) {
    positions(
      where: { owner: $owner }
      first: $first
      orderBy: createdAtTimestamp
      orderDirection: desc
    ) {
      tokenId
      owner
      origin
      createdAtTimestamp
    }
  }
`;

function gatewayUrl(apiKey: string, subgraphId: string): string {
  return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;
}

/**
 * Fetch positions owned by `walletAddress` from the v4 Base subgraph.
 *
 * Returns `null` when subgraph indexing is unconfigured (no API key) so
 * callers can degrade gracefully — e.g. /api/positions still serves
 * Mantua-opened rows. Other failures (network, GraphQL errors) throw.
 */
export async function fetchSubgraphPositions(
  walletAddress: string,
  options: { first?: number; signal?: AbortSignal } = {},
): Promise<SubgraphPosition[] | null> {
  if (!env.THE_GRAPH_API_KEY) return null;
  const first = options.first ?? 100;
  const url = gatewayUrl(env.THE_GRAPH_API_KEY, env.UNISWAP_V4_BASE_SUBGRAPH_ID);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: POSITIONS_BY_OWNER_QUERY,
      variables: { owner: walletAddress.toLowerCase(), first },
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`subgraph http ${String(res.status)}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as PositionsResponse;
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join("; ");
    throw new Error(`subgraph graphql: ${msg}`);
  }
  const positions = json.data?.positions ?? [];
  logger.debug({ wallet: walletAddress, count: positions.length }, "subgraph positions fetched");
  return positions;
}
