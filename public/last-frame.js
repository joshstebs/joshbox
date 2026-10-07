// Decode locally in the browser. The saved video stays behind the studio's media API.
export async function extractLastFrame(url) {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const wait = (event) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('The video took too long to decode. Download it and try again.')), 30000);
        function finish(error) { clearTimeout(timer); video.removeEventListener(event, ready); video.removeEventListener('error', failed); error ? reject(error) : resolve(); }
        function ready() { finish(); }
        function failed() { finish(new Error('This video could not be decoded on this device. Try Chrome or another saved MP4.')); }
        video.addEventListener(event, ready, { once: true });
        video.addEventListener('error', failed, { once: true });
    });
    try {
        const loaded = wait('loadeddata');
        video.src = url;
        await loaded;
        if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight)
            throw new Error('The saved video has no usable final frame.');
        if (video.videoWidth * video.videoHeight > 16_000_000)
            throw new Error('This video is too large to extend on this device.');
        const sought = wait('seeked');
        // A point just inside the end selects the final decoded presentation frame.
        video.currentTime = Math.max(0, video.duration - 0.001);
        await sought;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (!context)
            throw new Error('Your browser could not prepare the final frame.');
        context.drawImage(video, 0, 0);
        const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('The final frame could not be saved.')), 'image/png'));
        if (blob.size > 12 * 1024 ** 2)
            throw new Error('The final frame exceeds the 12 MB upload limit.');
        return new File([blob], 'previous-video-last-frame.png', { type: 'image/png' });
    }
    finally {
        video.removeAttribute('src');
        video.load();
    }
}
