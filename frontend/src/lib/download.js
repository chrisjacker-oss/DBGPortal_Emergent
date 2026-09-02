import api from "@/lib/api";

export async function downloadFile(path, filename, mime = "application/octet-stream") {
  const res = await api.get(path, { responseType: "blob" });
  const url = window.URL.createObjectURL(new Blob([res.data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export async function downloadCsv(path, filename) {
  return downloadFile(path, filename, "text/csv");
}
