// 日本語フォント（数MB）はビルドに同梱し、PDF書き出しのときだけ読む。
import fontUrl from "@expo-google-fonts/noto-sans-jp/400Regular/NotoSansJP_400Regular.ttf?url";

let pending = null;

// jsPDF の addFileToVFS に渡すバイナリ文字列。
export function loadReportFont() {
  pending ??= fetch(fontUrl)
    .then(response => {
      if (!response.ok) throw new Error("フォントを読み込めませんでした");
      return response.arrayBuffer();
    })
    .then(buffer => {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return binary;
    })
    .catch(error => {
      pending = null;
      throw error;
    });
  return pending;
}
