// src/utils/MarkdownWorker.js

export default class MarkdownWorker {
    constructor() {
        this.worker = new Worker(new URL('@/workers/markdown.worker.js', import.meta.url));
        this.callbacks = new Map();
        this.currentId = 0;

        this.worker.onmessage = (event) => {
            const { id, result, error } = event.data;
            const callback = this.callbacks.get(id);

            if (callback) {
                if (error) {
                    callback.reject(new Error(error));
                } else {
                    callback.resolve(result);
                }
                this.callbacks.delete(id);
            }
        };
    }

    render(raw) {
        return new Promise((resolve, reject) => {
            const id = ++this.currentId;
            this.callbacks.set(id, { resolve, reject });
            this.worker.postMessage({ id, raw });
        });
    }

    terminate() {
        this.worker.terminate();
        this.callbacks.clear();
    }
}