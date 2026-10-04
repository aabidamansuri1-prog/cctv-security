let audioCtx = null, lastAlertId = null, firstLoad = true, soundOn = false;
const $ = id => document.getElementById(id);

function enableSound() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  soundOn = true; beep();
  $('soundBtn').textContent = '🔊 Alarm sound enabled';
}
function beep() {
  if (!audioCtx) return;
  for (let i = 0; i < 4; i++) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'square'; o.frequency.value = i % 2 ? 900 : 1400;
    g.gain.value = 0.15; o.connect(g); g.connect(audioCtx.destination);
    o.start(audioCtx.currentTime + i * 0.25); o.stop(audioCtx.currentTime + i * 0.25 + 0.2);
  }
}
function dismissBanner() { $('alertBanner').classList.add('hidden'); }

async function pollStatus() {
  try {
    const s = await (await fetch('/api/status')).json();
    const b = $('camBadge');
    b.textContent = 'Camera: ' + (s.camera_ok ? 'Online' : 'Offline');
    b.className = 'badge ' + (s.camera_ok ? 'ok' : 'bad');
    const st = $('statusLine');
    st.textContent = 'Status: ' + s.status;
    st.className = 'status ' + (s.status.startsWith('ALERT') ? 'alert' : 'ok');
    $('statUsers').textContent = s.users; $('statAlerts').textContent = s.alerts;
    if (s.latest_alert) {
      if (!firstLoad && s.latest_alert.id !== lastAlertId) {
        $('alertTime').textContent = s.latest_alert.time;
        $('alertBanner').classList.remove('hidden');
        if (soundOn) beep();
        loadAlerts();
      }
      lastAlertId = s.latest_alert.id;
    }
    firstLoad = false;
  } catch (e) { $('camBadge').textContent = 'Server offline'; $('camBadge').className = 'badge bad'; }
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function zoom(src) { $('lightImg').src = src; $('lightbox').classList.remove('hidden'); }

async function loadUsers() {
  const u = await (await fetch('/api/users')).json();
  $('usersBody').innerHTML = u.length ? u.map(x =>
    `<tr><td>${x.id}</td><td>${esc(x.name)}</td><td>${x.created_at}</td>
     <td><button class="danger small" onclick="delUser(${x.id})">Delete</button></td></tr>`).join('')
    : '<tr><td colspan="4">No registered users yet</td></tr>';
}
async function loadAlerts() {
  const a = await (await fetch('/api/alerts')).json();
  $('alertsBody').innerHTML = a.length ? a.map(x =>
    `<tr><td>${x.id}</td><td>${esc(x.alert_type)}</td><td>${x.date}</td><td>${x.time}</td>
     <td><img src="/evidence/${x.image_path}" onclick="zoom('/evidence/${x.image_path}')"></td></tr>`).join('')
    : '<tr><td colspan="5">No alerts recorded</td></tr>';
}

async function startRegister() {
  const name = $('nameInput').value.trim();
  const r = await fetch('/api/register', {method: 'POST', headers: {'Content-Type': 'application/json'},
                                          body: JSON.stringify({name})});
  const d = await r.json();
  if (!r.ok) { $('regMsg').textContent = d.error; return; }
  $('regBtn').disabled = true; $('regMsg').textContent = 'Capturing... look at the camera.';
  loadUsers();
  const t = setInterval(async () => {
    const s = await (await fetch('/api/register/status')).json();
    $('regBar').style.width = (s.target ? 100 * s.count / s.target : 0) + '%';
    if (s.done) {
      clearInterval(t); $('regBtn').disabled = false; $('nameInput').value = '';
      $('regMsg').textContent = '✔ Registration complete.';
      loadUsers();
    }
  }, 300);
}
async function delUser(id) {
  if (!confirm('Delete this user?')) return;
  await fetch('/api/users/' + id, {method: 'DELETE'}); loadUsers();
}
async function clearAlerts() {
  if (!confirm('Delete all alert history and evidence images?')) return;
  await fetch('/api/alerts', {method: 'DELETE'}); loadAlerts();
}

const SRC_HINTS = {
  webcam: ['0', 'Webcam number: 0 = built-in, 1 = external.'],
  url: ['rtsp://user:password@192.168.1.10:554/stream', 'CCTV/NVR: rtsp://user:pass@IP:554/stream  |  Phone IP-camera app: http://IP:8080/video'],
  file: ['C:\\cctv_security\\demo.mp4', 'Full path of a recorded CCTV-style video (it loops).']
};
function srcTypeChanged() {
  const t = $('srcType').value; $('srcValue').value = SRC_HINTS[t][0]; $('srcHint').textContent = SRC_HINTS[t][1];
}
async function applySource() {
  const r = await fetch('/api/source', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({type: $('srcType').value, value: $('srcValue').value})});
  const d = await r.json();
  $('srcMsg').textContent = r.ok ? 'Source changed to: ' + d.label : d.error;
  loadSource();
}
async function setMonitoring(on) {
  await fetch('/api/monitoring', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({on})});
  if (window.BROWSER_MODE) { on ? startBrowserCamera() : stopBrowserCamera(); }
  loadSource();
}

// ---------- Browser camera mode (used when hosted on Render) ----------
// The browser opens the camera, uploads a frame, and shows the annotated frame the server returns.
let camStream = null, camRunning = false;
const camVideo = document.createElement('video');
camVideo.playsInline = true; camVideo.muted = true;
const camCanvas = document.createElement('canvas');

async function startBrowserCamera() {
  if (camRunning) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('srcMsg').textContent = 'Camera needs a secure (https) page.'; return;
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({video: {width: 640, height: 480}, audio: false});
  } catch (e) {
    $('srcMsg').textContent = 'Camera blocked (' + e.name + '). Allow camera access, then press Start monitoring.';
    return;
  }
  camVideo.srcObject = camStream;
  await camVideo.play();
  camRunning = true; $('srcMsg').textContent = '';
  browserLoop();
}
function stopBrowserCamera() {
  camRunning = false;
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
}
async function browserLoop() {
  const ctx = camCanvas.getContext('2d');
  while (camRunning) {
    const t0 = performance.now();
    const w = 640, h = Math.round(w * (camVideo.videoHeight || 480) / (camVideo.videoWidth || 640));
    camCanvas.width = w; camCanvas.height = h;
    ctx.drawImage(camVideo, 0, 0, w, h);
    const blob = await new Promise(r => camCanvas.toBlob(r, 'image/jpeg', 0.7));
    try {
      const res = await fetch('/api/frame', {method: 'POST', headers: {'Content-Type': 'image/jpeg'}, body: blob});
      if (res.ok) {
        const old = $('feed').src;
        $('feed').src = URL.createObjectURL(await res.blob());
        if (old.startsWith('blob:')) URL.revokeObjectURL(old);
      }
    } catch (e) { await new Promise(r => setTimeout(r, 1000)); }
    const wait = 150 - (performance.now() - t0);      // about 6 frames per second max
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
}
async function loadSource() {
  const d = await (await fetch('/api/source')).json();
  $('srcLabel').textContent = d.label + (d.monitoring ? '' : '  (stopped)');
}

if (window.BROWSER_MODE) {
  $('srcControls').style.display = 'none';      // webcam/RTSP/file options do not apply online
  startBrowserCamera();
}
loadSource(); loadUsers(); loadAlerts(); pollStatus(); setInterval(pollStatus, 1500);
