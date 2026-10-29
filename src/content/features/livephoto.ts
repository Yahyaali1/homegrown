// Living photo: a picture and its depth map become a 4 s clip. WebGL moves the camera (a slow dolly-in with a little
// sway); near pixels move more than far ones, which reads as depth. Nothing in the scene moves: no browser video model
// exists yet (docs/plan/Q-image-and-motion.md). Frames come from a timer, not requestAnimationFrame, so a hidden tab
// still records.

export const SECONDS = 4;
const FPS = 30;

/** data: URL → Blob without fetch, so the page's CSP never sees it. */
export function blobOf(dataUrl: string): Blob {
  const [head, body = ''] = dataUrl.split(',');
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: head!.slice(5).split(';')[0] ?? '' });
}

const VERT = `attribute vec2 p; varying vec2 uv; void main() { uv = vec2(p.x, -p.y) * .5 + .5; gl_Position = vec4(p, 0, 1); }`;
const FRAG = `precision mediump float;
varying vec2 uv; uniform sampler2D img, depth; uniform float t;
void main() {
  float d = texture2D(depth, uv).r;                     // 1 = near
  vec2 sway = vec2(sin(6.2832 * t), cos(6.2832 * t) - 1.) * vec2(.015, .008);
  float zoom = 1. + t * (.04 + .08 * d);                // near things come closer faster
  vec2 q = .5 + (uv - .5) / zoom + sway * (d - .5);
  gl_FragColor = texture2D(img, clamp(q, .001, .999));
}`;

/** A WebM clip of the picture coming alive. */
export async function animate(imageUrl: string, depthUrl: string): Promise<Blob> {
  const [img, depth] = await Promise.all([imageUrl, depthUrl].map((u) => createImageBitmap(blobOf(u))));
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [img!.width, img!.height];
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
  if (!gl) throw new Error('This browser has no WebGL, which living photos need.');
  const prog = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  [img!, depth!].forEach((bmp, i) => {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, i ? 'depth' : 'img'), i);
  });
  const t = gl.getUniformLocation(prog, 't');
  const draw = (x: number) => (gl.uniform1f(t, x), gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4));

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const type = ['video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))!;
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4e6 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  draw(0);
  rec.start();
  const frames = SECONDS * FPS;
  for (let f = 0; f <= frames; f++) {
    const x = f / frames;
    draw(x * x * (3 - 2 * x)); // ease in and out
    track.requestFrame();
    await new Promise((r) => setTimeout(r, 1000 / FPS));
  }
  rec.stop();
  await stopped;
  return new Blob(chunks, { type: 'video/webm' });
}
