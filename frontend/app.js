// DOM element references
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
const clearBtn = document.getElementById('clearBtn');
const usernameInput = document.getElementById('usernameInput');

// Random default username, editable by the user
let myUsername = "User-" + Math.floor(Math.random() * 1000);
usernameInput.value = myUsername;
usernameInput.addEventListener('change', (e) => myUsername = e.target.value);

// Drawing state and remote cursor tracking
let isDrawing = false;
let isEraser = false;
let lastX = 0, lastY = 0;
let remoteCursors = {}; 

// Network Batching Buffer
let strokeBuffer = [];

// Pen and eraser sizes, kept in sync with the sliders
let currentPenSize = parseInt(penSizeSlider.value);
let currentEraserSize = parseInt(eraserSizeSlider.value);

penSizeSlider.addEventListener('input', (e) => currentPenSize = parseInt(e.target.value));
eraserSizeSlider.addEventListener('input', (e) => currentEraserSize = parseInt(e.target.value));

// Toggle eraser mode and swap which controls are visible
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

// Trigger Clear Canvas State Machine Command
clearBtn.addEventListener('click', () => {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clear' }));
    }
});

// Handle messages from the gateway: sync, clear, strokes and health
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    // UI State Sync
    if (data.type === 'sync') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        data.log.forEach(entry => {
            const s = entry.stroke;
            if (s.type === 'clear') {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            } else if (s.type === 'stroke' || !s.type) {
                drawOnCanvas(s.startX, s.startY, s.endX, s.endY, s.color, s.isEraser, s.lineWidth);
            } else if (s.type === 'stroke-batch') {
                s.batch.forEach(item => {
                    drawOnCanvas(item.startX, item.startY, item.endX, item.endY, item.color, item.isEraser, item.lineWidth);
                });
            }
        });
    } 
    // State Machine Update: Clear
    else if (data.type === 'clear') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    // Live single stroke (Legacy)
    else if (data.type === 'stroke' && data.userName !== myUsername) {
        drawOnCanvas(data.startX, data.startY, data.endX, data.endY, data.color, data.isEraser, data.lineWidth);
        updateRemoteCursor(data.userName, data.endX, data.endY, data.color);
    } 
    // Live batched strokes
    else if (data.type === 'stroke-batch') {
        data.batch.forEach(item => {
            if (item.userName !== myUsername) {
                drawOnCanvas(item.startX, item.startY, item.endX, item.endY, item.color, item.isEraser, item.lineWidth);
                updateRemoteCursor(item.userName, item.endX, item.endY, item.color);
            }
        });
    }
    // Dashboard Telemetry
    else if (data.type === 'health-check') {
        const list = document.getElementById('cluster-list');
        if (list) {
            list.innerHTML = data.data.map(node => {
                let stateColor = "white";
                if (node.state === 'Leader') stateColor = "#4CAF50";
                if (node.state === 'Candidate') stateColor = "#FFC107";
                if (node.state === 'OFFLINE') stateColor = "#F44336";
                return `<li>${node.status} <strong>${node.id.toUpperCase()}</strong>: <span style="color: ${stateColor};">${node.state}</span> (Term: ${node.term})</li>`;
            }).join('');
        }
    }
};

// Unified local draw and buffer logic
function emitAndDraw(currentX, currentY) {
    const currentColor = colorPicker.value;
    const currentWidth = isEraser ? currentEraserSize : currentPenSize;

    drawOnCanvas(lastX, lastY, currentX, currentY, currentColor, isEraser, currentWidth);

    strokeBuffer.push({
        userName: myUsername,
        startX: lastX, startY: lastY, endX: currentX, endY: currentY,
        color: currentColor, isEraser: isEraser, lineWidth: currentWidth,
        timestamp: Date.now()
    });

    [lastX, lastY] = [currentX, currentY];
}

// Network Throttling / Batching Loop (50ms)
setInterval(() => {
    if (strokeBuffer.length > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'stroke-batch',
            batch: strokeBuffer
        }));
        strokeBuffer = []; 
    }
}, 50);

// Mobile Touch Events
// Convert a touch event to canvas coordinates
function getTouchPos(canvas, touchEvent) {
    const rect = canvas.getBoundingClientRect();
    return { x: touchEvent.touches[0].clientX - rect.left, y: touchEvent.touches[0].clientY - rect.top };
}

// Start, continue and end a stroke on touch
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
// Start, continue and end a stroke with the mouse
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
// Draw one line segment; eraser mode cuts pixels out instead
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

// Show or move a remote user's name tag, fading it after 1.5s idle
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