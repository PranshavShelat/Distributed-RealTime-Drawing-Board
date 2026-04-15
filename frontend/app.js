const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const statusDiv = document.getElementById('status');
const cursorsContainer = document.getElementById('cursors-container');

// UI Controls
const colorPicker = document.getElementById('colorPicker');
const eraserBtn = document.getElementById('eraserBtn');
const usernameInput = document.getElementById('usernameInput');

// Generate a random default name for this tab/device
let myUsername = "User-" + Math.floor(Math.random() * 1000);
usernameInput.value = myUsername;
usernameInput.addEventListener('change', (e) => myUsername = e.target.value);

let isDrawing = false;
let isEraser = false;
let lastX = 0, lastY = 0;
let remoteCursors = {}; 

// Toggle Eraser
eraserBtn.addEventListener('click', () => {
    isEraser = !isEraser;
    eraserBtn.innerText = isEraser ? "Eraser (ON)" : "Eraser (Off)";
    eraserBtn.classList.toggle('active', isEraser);
});

// --- THE MAGIC FIX: Dynamic WebSocket Connection ---
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
            drawOnCanvas(s.startX, s.startY, s.endX, s.endY, s.color, s.isEraser);
        });
    } else if (data.type === 'stroke') {
        if (data.userName !== myUsername) {
            drawOnCanvas(data.startX, data.startY, data.endX, data.endY, data.color, data.isEraser);
            updateRemoteCursor(data.userName, data.endX, data.endY, data.color);
        }
    }
};

// Handle Touch Events for Mobile Phones
function getTouchPos(canvas, touchEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: touchEvent.touches[0].clientX - rect.left,
        y: touchEvent.touches[0].clientY - rect.top
    };
}

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Prevent scrolling while drawing
    isDrawing = true;
    const pos = getTouchPos(canvas, e);
    [lastX, lastY] = [pos.x, pos.y];
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!isDrawing) return;
    const pos = getTouchPos(canvas, e);
    const currentX = pos.x;
    const currentY = pos.y;
    const currentColor = colorPicker.value;

    drawOnCanvas(lastX, lastY, currentX, currentY, currentColor, isEraser);

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'stroke',
            userName: myUsername,
            startX: lastX,
            startY: lastY,
            endX: currentX,
            endY: currentY,
            color: currentColor,
            isEraser: isEraser,
            timestamp: Date.now()
        }));
    }
    [lastX, lastY] = [currentX, currentY];
}, { passive: false });

canvas.addEventListener('touchend', () => isDrawing = false);

// Standard Mouse Events for Laptop
canvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    [lastX, lastY] = [e.offsetX, e.offsetY];
});

canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const currentX = e.offsetX;
    const currentY = e.offsetY;
    const currentColor = colorPicker.value;

    drawOnCanvas(lastX, lastY, currentX, currentY, currentColor, isEraser);

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'stroke',
            userName: myUsername,
            startX: lastX,
            startY: lastY,
            endX: currentX,
            endY: currentY,
            color: currentColor,
            isEraser: isEraser,
            timestamp: Date.now()
        }));
    }
    [lastX, lastY] = [currentX, currentY];
});

canvas.addEventListener('mouseup', () => isDrawing = false);
canvas.addEventListener('mouseout', () => isDrawing = false);

function drawOnCanvas(x1, y1, x2, y2, color, isEraserMode) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    
    if (isEraserMode) {
        ctx.globalCompositeOperation = 'destination-out'; 
        ctx.lineWidth = 25;
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
    }
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.closePath();
}

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