const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const statusDiv = document.getElementById('status');
const cursorsContainer = document.getElementById('cursors-container');

const colorPicker = document.getElementById('colorPicker');
const colorContainer = document.getElementById('colorContainer');
const penSizeSlider = document.getElementById('penSize');
const penSizeContainer = document.getElementById('penSizeContainer');

const eraserBtn = document.getElementById('eraserBtn');
const eraserSizeSlider = document.getElementById('eraserSize');
const eraserSizeContainer = document.getElementById('eraserSizeContainer');
const usernameInput = document.getElementById('usernameInput');

let myUsername = "User-" + Math.floor(Math.random() * 1000);
usernameInput.value = myUsername;
usernameInput.addEventListener('change', (e) => myUsername = e.target.value);

let isDrawing = false;
let isEraser = false;
let lastX = 0, lastY = 0;
let remoteCursors = {}; 

let currentPenSize = parseInt(penSizeSlider.value);
let currentEraserSize = parseInt(eraserSizeSlider.value);

penSizeSlider.addEventListener('input', (e) => currentPenSize = parseInt(e.target.value));
eraserSizeSlider.addEventListener('input', (e) => currentEraserSize = parseInt(e.target.value));

// Toggle eraser state and UI visibility
eraserBtn.addEventListener('click', () => {
    isEraser = !isEraser;
    eraserBtn.innerText = isEraser ? "Eraser (ON)" : "Eraser (Off)";
    eraserBtn.classList.toggle('active', isEraser);

    eraserSizeContainer.style.display = isEraser ? 'inline-block' : 'none';
    penSizeContainer.style.display = isEraser ? 'none' : 'inline-block';
    colorContainer.style.display = isEraser ? 'none' : 'inline-block';
});

// WebSocket Setup
const wsUrl = `ws://${window.location.hostname}:8080`;
const ws = new WebSocket(wsUrl);

ws.onopen = () => statusDiv.innerText = `Connected to Cluster (${window.location.hostname}) 🟢`;
ws.onclose = () => statusDiv.innerText = "Disconnected. Retrying... 🔴";

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'sync') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        data.log.forEach(entry => {
            const s = entry.stroke;
            drawOnCanvas(s.startX, s.startY, s.endX, s.endY, s.color, s.isEraser, s.lineWidth);
        });
    } else if (data.type === 'stroke' && data.userName !== myUsername) {
        drawOnCanvas(data.startX, data.startY, data.endX, data.endY, data.color, data.isEraser, data.lineWidth);
        updateRemoteCursor(data.userName, data.endX, data.endY, data.color);
    }
};

// Unified local draw and network emit logic
function emitAndDraw(currentX, currentY) {
    const currentColor = colorPicker.value;
    const currentWidth = isEraser ? currentEraserSize : currentPenSize;

    drawOnCanvas(lastX, lastY, currentX, currentY, currentColor, isEraser, currentWidth);

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'stroke', userName: myUsername,
            startX: lastX, startY: lastY, endX: currentX, endY: currentY,
            color: currentColor, isEraser: isEraser, lineWidth: currentWidth,
            timestamp: Date.now()
        }));
    }
    [lastX, lastY] = [currentX, currentY];
}

// Mobile Touch Events
function getTouchPos(canvas, touchEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: touchEvent.touches[0].clientX - rect.left,
        y: touchEvent.touches[0].clientY - rect.top
    };
}

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isDrawing = true;
    const pos = getTouchPos(canvas, e);
    [lastX, lastY] = [pos.x, pos.y];
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!isDrawing) return;
    const pos = getTouchPos(canvas, e);
    emitAndDraw(pos.x, pos.y);
}, { passive: false });

canvas.addEventListener('touchend', () => isDrawing = false);

// Desktop Mouse Events
canvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    [lastX, lastY] = [e.offsetX, e.offsetY];
});

canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    emitAndDraw(e.offsetX, e.offsetY);
});

canvas.addEventListener('mouseup', () => isDrawing = false);
canvas.addEventListener('mouseout', () => isDrawing = false);

// Rendering Engine
function drawOnCanvas(x1, y1, x2, y2, color, isEraserMode, lineWidth) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    
    if (isEraserMode) {
        ctx.globalCompositeOperation = 'destination-out'; 
        ctx.lineWidth = lineWidth || 25; 
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth || 4; 
    }
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.closePath();
}

// Remote Cursor Tracking
function updateRemoteCursor(userName, x, y, color) {
    if (!remoteCursors[userName]) {
        const el = document.createElement('div');
        el.className = 'remote-cursor';
        el.innerText = userName;
        cursorsContainer.appendChild(el);
        remoteCursors[userName] = { element: el, timeout: null };
    }

    const cursor = remoteCursors[userName];
    cursor.element.style.left = x + 10 + 'px';
    cursor.element.style.top = y + 10 + 'px';
    cursor.element.style.backgroundColor = color; 
    cursor.element.style.opacity = 1;

    clearTimeout(cursor.timeout);
    cursor.timeout = setTimeout(() => cursor.element.style.opacity = 0, 1500);
}