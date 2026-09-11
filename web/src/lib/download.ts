// Web's equivalent of app/'s expo-sharing share sheet: there's no OS share sheet here, so
// a browser download is the adaptation — see CLAUDE.md's feature-parity policy on
// adapting the mechanism per platform rather than dropping the feature.
export function downloadText(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
