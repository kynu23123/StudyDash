import { useEffect, useRef, useState } from "react";

const vertex = `attribute vec2 position;
void main(){gl_Position=vec4(position,0.0,1.0);}`;
const fragment = `precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform vec3 accent;
uniform vec3 background;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
 vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
}
void main(){
 vec2 uv=gl_FragCoord.xy/resolution;
 float t=time*.075;
 float warp=noise(uv*3.0+vec2(t*.3,-t*.2));
 vec2 left=vec2(-.11,.45+.27*sin(t*.65));
 vec2 top=vec2(.65+.22*cos(t*.51),1.15);
 vec2 d1=(uv-left)*vec2(2.6,.9);
 vec2 d2=(uv-top)*vec2(.85,2.5);
 float breath1=.5+.5*sin(t*.7);
 float breath2=.5+.5*cos(t*.58);
 float leak1=exp(-dot(d1,d1)*3.0)*(0.12+breath1*.32);
 float leak2=exp(-dot(d2,d2)*4.0)*(0.10+breath2*.30);
 float streak=.8+.2*sin(uv.y*32.0+warp*8.0+t);
 float exposure=clamp((leak1+leak2)*(.65+warp*.5)*streak,0.0,.36);
 vec3 tint=mix(accent,vec3(1.),.12);
 float light=dot(background,vec3(.2126,.7152,.0722));
 vec3 color=light>.55 ? mix(background,accent,exposure*.6) : background+tint*exposure;
 float grain=(hash(gl_FragCoord.xy+floor(time*24.0))-.5)*.008;
 gl_FragColor=vec4(clamp(color+grain,0.0,1.0),1.0);
}`;

export function LightLeakShader({ paused }: { paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  const drawRef = useRef<() => void>(() => {});
  const [fallback, setFallback] = useState(false);
  useEffect(() => { pausedRef.current = paused; drawRef.current(); }, [paused]);
  useEffect(() => {
    const surface = canvas.current!;
    const gl = surface.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
    if (!gl) { setFallback(true); return; }
    const shaders: WebGLShader[] = [];
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source); gl.compileShader(shader); shaders.push(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram()!;
    if (vs && fs) { gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program); }
    if (!vs || !fs || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setFallback(true); shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteProgram(program); return;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program,"position");
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    const uniforms = Object.fromEntries(["resolution","time","accent","background"].map(name => [name, gl.getUniformLocation(program,name)]));
    let frame = 0, elapsed = 0, last = 0, painted = 0, disposed = false;
    const pixel = document.createElement("canvas").getContext("2d")!;
    const rgb = (value: string) => {
      pixel.clearRect(0,0,1,1); pixel.fillStyle = value; pixel.fillRect(0,0,1,1);
      return Array.from(pixel.getImageData(0,0,1,1).data).slice(0,3).map(channel => channel / 255);
    };
    const colors = () => {
      const style = getComputedStyle(surface);
      const a = style.getPropertyValue("--study-accent").trim() || style.getPropertyValue("--accent").trim();
      const b = style.getPropertyValue("--study-bg").trim() || style.getPropertyValue("--bg").trim();
      gl.uniform3fv(uniforms.accent,rgb(a)); gl.uniform3fv(uniforms.background,rgb(b));
    };
    const paint = (now: number) => {
      frame = 0;
      if (disposed) return;
      const running = !pausedRef.current;
      if (running && last) elapsed += Math.min(now-last,100);
      last = running ? now : 0;
      if (!running || now-painted >= 1000/30) {
        gl.uniform2f(uniforms.resolution,surface.width,surface.height);
        gl.uniform1f(uniforms.time,elapsed/1000);
        gl.drawArrays(gl.TRIANGLES,0,6); painted = now;
      }
      if (running) frame = requestAnimationFrame(paint);
    };
    const requestPaint = () => {
      cancelAnimationFrame(frame); last = 0;
      frame = requestAnimationFrame(paint);
    };
    drawRef.current = requestPaint;
    const resize = new ResizeObserver(() => {
      const bounds = surface.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio || 1,1.5,1600/Math.max(bounds.width,1));
      surface.width = Math.max(1,Math.round(bounds.width*ratio));
      surface.height = Math.max(1,Math.round(bounds.height*ratio));
      gl.viewport(0,0,surface.width,surface.height); requestPaint();
    });
    resize.observe(surface);
    const observer = new MutationObserver(() => { colors(); requestPaint(); });
    observer.observe(document.documentElement,{attributes:true,attributeFilter:["style","data-mode"]});
    observer.observe(document.getElementById("studyStage")!,{attributes:true,attributeFilter:["style"]});
    const lost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frame); disposed = true; setFallback(true); };
    surface.addEventListener("webglcontextlost",lost);
    colors(); requestPaint();
    return () => {
      disposed = true; cancelAnimationFrame(frame); drawRef.current = () => {};
      resize.disconnect(); observer.disconnect(); surface.removeEventListener("webglcontextlost",lost);
      gl.deleteBuffer(buffer); shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteProgram(program);
    };
  }, []);
  return <div className="sd-light-leak" data-renderer={fallback ? "fallback" : "webgl"} aria-hidden="true">
    <canvas ref={canvas} hidden={fallback} />
  </div>;
}
