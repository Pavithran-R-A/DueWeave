// A download that the browser never accepted is not a download. This helper hands
// the file to the browser's own mechanism and only returns once the anchor click
// that starts it has happened, so the caller can promise "saved" no earlier than
// the truth allows.

export function downloadGeneratedFile(filename: string, mimeType: string, contents: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
