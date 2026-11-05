import { useEffect } from "react";

declare global {
  interface Window { studyDashDesktop?: { setAppIcon?: (value: string) => void } }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
  });
}

function paintNotebook(image: HTMLImageElement, accent: string, dark: boolean) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, 256, 256), data = pixels.data;
  const face = new Uint8Array(65536), seen = new Uint8Array(65536);
  const queue = [90*256+128];
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    if (index < 0 || index >= 65536 || seen[index]) continue;
    seen[index] = 1;
    if (!data[index*4+3] || (dark ? data[index*4] === 0 : data[index*4] === 255)) continue;
    face[index] = 1;
    if (index%256) queue.push(index-1);
    if (index%256 < 255) queue.push(index+1);
    queue.push(index-256,index+256);
  }
  // Fill enclosed pen strokes so their ink remains readable after recoloring the paper.
  seen.fill(0); queue.length = 0; queue.push(0);
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    if (index < 0 || index >= 65536 || seen[index] || face[index]) continue;
    seen[index] = 1;
    if (index%256) queue.push(index-1);
    if (index%256 < 255) queue.push(index+1);
    queue.push(index-256,index+256);
  }
  const rgb = accent.slice(1).match(/../g)!.map(channel => parseInt(channel,16));
  const linear = rgb.map(channel => { const value = channel/255; return value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4; });
  const ink = linear[0]*.2126+linear[1]*.7152+linear[2]*.0722 > .179 ? 0 : 255;
  for (let index = 0; index < 65536; index++) {
    if (!face[index] && seen[index]) continue;
    const paper = dark ? data[index*4]/255 : 1-data[index*4]/255;
    for (let channel = 0; channel < 3; channel++) data[index*4+channel] = Math.round(rgb[channel]*paper+ink*(1-paper));
  }
  context.putImageData(pixels,0,0);
  const output = document.createElement("canvas"); output.width = output.height = 256;
  output.getContext("2d")!.drawImage(canvas,48,52,160,136,8,26,240,204);
  return output.toDataURL("image/png");
}

export function NotebookIcon() {
  useEffect(() => {
    let disposed = false, previous = "";
    const root = document.documentElement, system = matchMedia("(prefers-color-scheme: dark)");
    let images: HTMLImageElement[] | undefined;
    const update = () => {
      if (disposed || !images) return;
      const dark = root.dataset.mode === "dark" || (root.dataset.mode === "system" && system.matches);
      const accent = getComputedStyle(root).getPropertyValue("--accent").trim();
      if (!/^#[0-9a-f]{6}$/i.test(accent)) return;
      const key = `${dark}:${accent}`;
      if (key === previous) return;
      previous = key;
      const url = paintNotebook(images[dark ? 0 : 1],accent,dark);
      document.querySelectorAll<HTMLImageElement>("[data-studydash-icon]").forEach(image => { image.src = url; });
      const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (favicon) favicon.href = url;
      window.studyDashDesktop?.setAppIcon?.(url);
    };
    const schedule = () => queueMicrotask(update);
    const observer = new MutationObserver(schedule);
    observer.observe(root,{attributes:true,attributeFilter:["style","data-mode"]});
    system.addEventListener("change",schedule);
    Promise.all([loadImage("/assets/icon-dark.png"),loadImage("/assets/icon-light.png")]).then(loaded => { images = loaded; update(); }).catch(() => {});
    return () => { disposed = true; observer.disconnect(); system.removeEventListener("change",schedule); };
  }, []);
  return null;
}
