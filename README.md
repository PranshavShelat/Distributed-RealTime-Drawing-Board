# **Distributed Real-Time Collaboration Board**

A fault-tolerant, distributed real-time drawing board built with Node.js, WebSockets, and Docker. This project implements a custom version of the RAFT consensus algorithm to manage leader election, state replication, and data consistency across multiple backend nodes.

## **System Architecture**

The application is containerized using Docker Compose and is divided into three primary layers:

1. **The Frontend:** An HTML5 Canvas and vanilla JavaScript client utilizing Optimistic Rendering and Network Batching (50ms throttling) to maintain a zero-lag user interface while drastically reducing server load.  
2. **The Gateway:** A Node.js/Express reverse proxy that handles incoming WebSocket connections, routes traffic to the active Raft Leader, and broadcasts cluster telemetry.  
3. **The Replicas (State Machine):** A cluster of three isolated Node.js backend servers. They utilize a custom RAFT implementation to handle leader elections, enforce quorum (majority voting) for data writes via a two-phase commit, and execute self-healing protocols for node crash recovery.

## **Prerequisites**

Ensure you have the following installed on your machine:

* [Docker](https://docs.docker.com/get-docker/)  
* [Docker Compose](https://docs.docker.com/compose/install/)

## **Installation & Setup**

1. Clone the repository and navigate into the project directory:  
   git clone \<your-repository-url\>  
   cd Distributed-RealTime-Drawing-Board

2. Build and start the cluster:  
   docker-compose up \--build

   *(Note: If you are using newer versions of Docker Desktop, you may need to use docker compose up \--build without the hyphen).*

## **Accessing the Application**

### **1\. From the Host Machine**

Once the cluster is running and a Leader has been elected, open your web browser and navigate to:  
http://localhost:8081

### **2\. From Another Device on the Same Network (LAN)**

To collaborate using a phone, tablet, or another computer on the same Wi-Fi network, you must connect via your host machine's local IP address.

1. **Find your local IP address:**  
   * **Mac:** Hold Option and click the Wi-Fi icon in the menu bar to reveal your IP Address (e.g., 192.168.1.15).  
   * **Windows:** Open Command Prompt and type ipconfig, then look for the IPv4 Address.  
2. **Connect the device:**  
   Open a web browser on the secondary device and navigate to your IP address followed by the Gateway port (8081):  
   http://\<YOUR\_LOCAL\_IP\_ADDRESS\>:8081

## **Managing the Cluster & Testing Fault Tolerance**

Because this is a distributed system, you can simulate server crashes and network partitions to observe the RAFT algorithm in real-time via the frontend Observability Dashboard.  
Open a new terminal window inside the project directory to execute these commands.  
**Stop a specific replica (Simulate a crash):**  
docker-compose stop replica1

*Observe the dashboard as the replica goes offline. If it was the Leader, a new election will automatically trigger.*  
**Start a specific replica (Simulate a reboot):**  
docker-compose start replica1

*The node will return as a Follower, realize its log is outdated, and automatically execute the /sync-log catch-up protocol to restore its state.*  
**Stop the entire cluster gracefully:**  
docker-compose stop

**Tear down the cluster and remove virtual networks:**  
docker-compose down

## **Key Engineering Features**

* **Custom Consensus Protocol:** Built a mini-RAFT algorithm from scratch to ensure CP (Consistency and Partition Tolerance) adherence under the CAP theorem.  
* **Service Discovery & Failover:** The Gateway intelligently monitors node health and automatically reroutes traffic to the newly elected leader during crash events.  
* **Network Optimization:** Implemented WebSocket event batching, reducing server throughput load by over 90% during rapid drawing sessions.  
* **Live Telemetry:** Built a real-time observability dashboard into the client UI to track term numbers, node states, and cluster health.