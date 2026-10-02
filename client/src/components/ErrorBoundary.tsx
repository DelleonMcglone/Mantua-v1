import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Where "Close" goes — the screen the user came from. */
  onClose: () => void;
  label?: string;
}

/**
 * A render crash in one panel must not take the whole app to a blank page
 * with no way out. The panel is replaced by a short message and a Close
 * button; the rest of the shell (header, dock, navigation) keeps working.
 */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("panel crashed", error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-20 text-center">
        <p className="text-[15px] font-semibold">
          {this.props.label ?? "This screen"} hit a problem.
        </p>
        <p className="text-[13px] text-text-dim">Nothing was lost. Close it and try again.</p>
        <button
          type="button"
          onClick={() => {
            this.setState({ failed: false });
            this.props.onClose();
          }}
          className="rounded-full border border-border-soft bg-transparent px-4 py-2 text-[13px] font-medium text-text-dim transition-colors hover:text-text cursor-pointer"
        >
          Close
        </button>
      </div>
    );
  }
}
