import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

type Props = { children: ReactNode; language: "ja" | "en" };
type State = { error: Error | null };

/** Last line of defence: a readable recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const ja = this.props.language === "ja";
    return (
      <main className="app">
        <section className="app-frame">
          <div className="screen crash">
            <h1>{ja ? "問題が発生しました" : "Something went wrong"}</h1>
            <p>
              {ja
                ? "画面の表示中にエラーが起きました。ルームのデータは保存されています。"
                : "The screen failed to render. Your room data is safe."}
            </p>
            <button
              className="button button--primary button--block"
              type="button"
              onClick={() => window.location.reload()}
            >
              {ja ? "再読み込み" : "Reload"}
            </button>
            <details>
              <summary>{ja ? "エラーの詳細" : "Error details"}</summary>
              <pre>{this.state.error.message}</pre>
            </details>
          </div>
        </section>
      </main>
    );
  }
}
