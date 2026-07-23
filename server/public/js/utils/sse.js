class SSEClient {
  constructor(url, handlers = {}) {
    this.url = url;
    this.handlers = handlers;
    this.eventSource = null;
    this.reconnectTimeout = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
  }

  connect() {
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.updateStatus('connecting');
    this.eventSource = new EventSource(this.url);

    this.eventSource.onopen = () => {
      this.updateStatus('connected');
      this.reconnectDelay = 1000;
      if (this.handlers.onConnect) this.handlers.onConnect();
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (this.handlers.onMessage) this.handlers.onMessage(data);
        
        if (data.type && this.handlers[data.type]) {
          this.handlers[data.type](data.payload);
        }
      } catch (error) {
        console.error('Error parsing SSE message:', error);
      }
    };

    this.eventSource.onerror = () => {
      this.eventSource.close();
      this.updateStatus('disconnected');
      this.scheduleReconnect();
    };
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
    
    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  updateStatus(status) {
    if (this.handlers.onStatusChange) {
      this.handlers.onStatusChange(status);
    }
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    clearTimeout(this.reconnectTimeout);
    this.updateStatus('disconnected');
  }
}

window.SSEClient = SSEClient;
