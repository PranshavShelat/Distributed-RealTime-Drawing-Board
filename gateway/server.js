// Dependencies
const express = require('express');
const { WebSocketServer } = require('ws');
const axios = require('axios');
const path = require('path');

// Ports and replica addresses on the Docker network
const HTTP_PORT = 8081;
const WS_PORT = 8080;
const REPLICAS = ['http://replica1:3000', 'http://replica2:3000', 'http://replica3:3000'];

// Cached leader URL and Express app that serves the frontend
let currentLeader = null;
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// WebSocket server for browser clients
const wss = new WebSocketServer({ port: WS_PORT });

// --- Client Connections ---
wss.on('connection', async (ws) => {
    console.log('Gateway: New client connected');
    
    // Fetch full canvas state from leader and send to new client
    const leaderUrl = await getActiveLeader();
    if (leaderUrl) {
        try {
            const res = await axios.get(`${leaderUrl}/full-log`);
            ws.send(JSON.stringify({ type: 'sync', log: res.data.log }));
        } catch (err) {
            console.error('Failed to sync history from leader');
        }
    }

    // Forward drawing commands from this client to the leader
    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        
        // Accept single strokes, batches, and state machine 'clear' commands
        if (data.type === 'stroke' || data.type === 'stroke-batch' || data.type === 'clear') {
            const success = await forwardToLeader(data);
            
            // Ghost Stroke Fix: If the leader crashed before achieving quorum, force UI sync
            if (!success) {
                console.log("Gateway: Notifying client of dropped state. Forcing UI sync.");
                const activeLeader = await getActiveLeader();
                if (activeLeader) {
                    try {
                        const res = await axios.get(`${activeLeader}/full-log`);
                        ws.send(JSON.stringify({ type: 'sync', log: res.data.log }));
                    } catch (err) { /* Will retry on next UI interaction */ }
                }
            }
        }
    });
});

// --- Internal Endpoints (Called by Leader) ---
// Push a committed stroke to every connected client
app.post('/broadcast', (req, res) => {
    const payload = req.body;
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(JSON.stringify(payload)); 
        }
    });
    res.sendStatus(200);
});

// --- Routing Logic ---
// Return the cached leader, or find it by polling each replica's /status
async function getActiveLeader() {
    if (currentLeader) return currentLeader;
    
    for (const replica of REPLICAS) {
        try {
            const res = await axios.get(`${replica}/status`, { timeout: 1000 });
            if (res.data.state === 'Leader') {
                currentLeader = replica;
                return replica;
            } else if (res.data.leaderId) {
                currentLeader = `http://${res.data.leaderId}:3000`;
                return currentLeader;
            }
        } catch (e) { /* Node down */ }
    }
    return null;
}

// Forward to Leader now returns Boolean status for UI Sync validation
async function forwardToLeader(stroke) {
    const leaderUrl = await getActiveLeader();
    if (!leaderUrl) {
        console.log("Gateway: No active leader found, dropping stroke.");
        return false;
    }

    try {
        const res = await axios.post(`${leaderUrl}/client-request`, stroke, { timeout: 1000 });
        if (!res.data.success && res.data.leaderId) {
            // Cache invalidation & retry
            currentLeader = `http://${res.data.leaderId}:3000`;
            return await forwardToLeader(stroke); 
        }
        return true; 
    } catch (e) {
        console.log(`Gateway: Leader ${leaderUrl} failed. Triggering failover.`);
        currentLeader = null; 
        return false; 
    }
}

// --- Cluster Health Monitor ---
// Every 2s, poll each replica's status and push it to all clients
setInterval(async () => {
    const clusterStatus = [];
    
    for (let i = 1; i <= 3; i++) {
        const replicaName = `replica${i}`;
        try {
            const res = await axios.get(`http://${replicaName}:3000/status`, { timeout: 500 });
            clusterStatus.push({
                id: replicaName,
                state: res.data.state,
                term: res.data.currentTerm || res.data.term || '?', 
                status: '🟢'
            });
        } catch (e) {
            clusterStatus.push({ id: replicaName, state: 'OFFLINE', term: '-', status: '🔴' });
        }
    }

    const healthPayload = JSON.stringify({ type: 'health-check', data: clusterStatus });
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(healthPayload);
    });
}, 2000); 

// Start the HTTP server (frontend + internal endpoints)
app.listen(HTTP_PORT, () => console.log(`Gateway listening on port ${HTTP_PORT}`));