/** Uses the native share sheet when available, otherwise copies to the clipboard. */
export async function shareText(text: string, title: string, onCopied: () => void) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  await navigator.clipboard?.writeText(text);
  onCopied();
}
