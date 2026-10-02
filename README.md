# Distributed Real-Time Collaboration Board

A fault-tolerant, distributed real-time drawing board built with Node.js, Express, WebSockets, and Docker. Multiple users draw on a shared canvas and see each other's strokes live. The backend runs a custom Raft-style consensus protocol for leader election, log replication, and majority-based commits across three replica nodes.

## System Architecture

The application is containerized using Docker Compose and is divided into three layers:

1. **The Frontend:** An HTML5 Canvas and vanilla JavaScript client. Strokes are drawn locally right away (optimistic rendering), and pointer events are batched into one WebSocket message every 50ms instead of one message per mouse or touch move. Supports pen colors and sizes, an eraser, clearing the canvas, and live name tags for other users' cursors.
2. **The Gateway:** A Node.js service (Express + `ws`) that serves the frontend, accepts WebSocket connections, forwards drawing commands to the current Raft leader, broadcasts committed strokes to every client, and pushes cluster health to the dashboard every 2 seconds. New clients receive the full committed board when they connect.
3. **The Replicas:** A cluster of three Node.js/Express servers running a custom Raft-style protocol. They elect a leader using terms and randomized election timeouts, and the leader replicates each write to the followers and commits it only once a majority (2 of 3) has stored it. Nodes communicate over HTTP, and a follower that falls behind is brought up to date by the leader through a `/sync-log` catch-up endpoint.

## Prerequisites

Ensure you have the following installed on your machine:

* [Docker](https://docs.docker.com/get-docker/)
* [Docker Compose](https://docs.docker.com/compose/install/)

## Installation & Setup

1. Clone the repository and navigate into the project directory:

   ```bash
   git clone https://github.com/PranshavShelat/Distributed-RealTime-Drawing-Board.git
   cd Distributed-RealTime-Drawing-Board
   ```

2. Start the cluster:

   ```bash
   docker-compose up
   ```

   *(Note: With newer versions of Docker Desktop, use `docker compose up` without the hyphen. The first start takes a little longer because each container runs `npm install`.)*

### Ports

| Port | Service |
| --- | --- |
| 8081 | Frontend (HTTP) |
| 8080 | WebSocket connection used by the frontend |
| 3001–3003 | Replicas 1–3 (e.g. `curl localhost:3001/status`) |

## Accessing the Application

### 1. From the Host Machine

Once the cluster is running and a Leader has been elected (shown on the dashboard), open your web browser and navigate to:

```
http://localhost:8081
```

### 2. From Another Device on the Same Network (LAN)

To collaborate using a phone, tablet, or another computer on the same Wi-Fi network, connect via your host machine's local IP address.

1. **Find your local IP address:**
   * **Mac:** Hold Option and click the Wi-Fi icon in the menu bar to reveal your IP Address (e.g., 192.168.1.15).
   * **Windows:** Open Command Prompt and type `ipconfig`, then look for the IPv4 Address.
2. **Connect the device:**
   Open a web browser on the secondary device and navigate to your IP address followed by the Gateway port (8081):

   ```
   http://<YOUR_LOCAL_IP_ADDRESS>:8081
   ```

   Both ports 8081 and 8080 must be reachable from the device, so allow them through your firewall if needed.

## Managing the Cluster & Testing Fault Tolerance

You can simulate server crashes and watch the cluster recover in real time via the Observability Dashboard in the frontend. Run these commands from a new terminal window inside the project directory.

**Stop a specific replica (simulate a crash):**

```bash
docker-compose stop replica1
```

*Watch the dashboard as the replica goes offline. If it was the Leader, the remaining replicas automatically elect a new one and drawing continues.*

**Start a specific replica (simulate a reboot):**

```bash
docker-compose start replica1
```

*The node rejoins as a Follower with an empty log. The next time anyone draws, the leader detects that the follower is behind and sends it the missing entries through `/sync-log`.*

Writes need a majority, so if two replicas are stopped at the same time, new strokes are not committed until one of them comes back.

**Stop the entire cluster:**

```bash
docker-compose stop
```

**Tear down the cluster and remove its containers and network:**

```bash
docker-compose down
```

*Board state is kept in memory on the replicas, so restarting the whole cluster starts with an empty board.*

## Key Engineering Features

* **Custom Consensus Protocol:** Built a Raft-style leader election and log replication protocol from scratch (no consensus library). A write commits only when a majority of replicas acknowledge it, so a minority of nodes can never commit on its own, favouring consistency over availability (CP under the CAP theorem).
* **Leader Discovery & Failover:** The Gateway caches the current leader, follows leader redirects from followers, and rediscovers the leader by polling the replicas when a request fails, so traffic moves to the newly elected leader after a crash.
* **Network Optimization:** Pointer events are batched into one WebSocket message every 50ms, so each message and each Raft write carries several line segments instead of one.
* **Ghost-Stroke Reconciliation:** If a write fails to commit, the Gateway re-sends the committed board to that client, so strokes that never committed disappear from the screen.
* **Live Telemetry:** A real-time observability dashboard in the client UI shows each node's role, term number, and online/offline status, refreshed every 2 seconds.
