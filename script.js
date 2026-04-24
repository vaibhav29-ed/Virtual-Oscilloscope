//app.js
let running = false;
let frozen = false;
let singleTriggered = false;
let viewMode = "time"; // "time", "fft", "both"

// Element references
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");

// Tab logic
document.getElementById("tabTime").onclick = function () {
    viewMode = "time";
    document.getElementById("scopeCanvas").style.display = "block";
    document.getElementById("fftCanvas").style.display = "none";
    updateTabs(this);
};

document.getElementById("tabFFT").onclick = function () {
    viewMode = "fft";
    document.getElementById("scopeCanvas").style.display = "none";
    document.getElementById("fftCanvas").style.display = "block";
    updateTabs(this);
};

document.getElementById("tabBoth").onclick = function () {
    viewMode = "both";
    document.getElementById("scopeCanvas").style.display = "block";
    document.getElementById("fftCanvas").style.display = "block";
    updateTabs(this);
};

function updateTabs(activeTab) {
    document.getElementById("tabTime").classList.remove("active");
    document.getElementById("tabFFT").classList.remove("active");
    document.getElementById("tabBoth").classList.remove("active");
    activeTab.classList.add("active");
}

// UI State functions
function setRunningState() {
    btnStart.style.display = "none";
    btnStop.style.display = "inline-block";
    statusDot.classList.add("active");
    statusText.textContent = "Running";
}

function setStoppedState() {
    btnStart.style.display = "inline-block";
    btnStop.style.display = "none";
    statusDot.classList.remove("active");
    statusText.textContent = "Stopped";
}

// Update slider value text
const uiElements = [
    { id: "timeDiv", valId: "valTime", suffix: " ms" },
    { id: "hPos", valId: "valHpos", suffix: "" },
    { id: "voltsDiv", valId: "valVolts", suffix: "%" },
    { id: "vOffset", valId: "valVoff", suffix: "" },
    { id: "trigThreshold", valId: "valTrig", suffix: "%" },
    { id: "lineWidth", valId: "valLine", suffix: "" },
    { id: "persistence", valId: "valPersist", suffix: "%" },
    { id: "gridBright", valId: "valGrid", suffix: "%" }
];

uiElements.forEach(item => {
    const el = document.getElementById(item.id);
    const valEl = document.getElementById(item.valId);
    if (el && valEl) {
        el.addEventListener('input', function () {
            valEl.textContent = this.value + item.suffix;
        });
    }
});

btnStart.onclick = async function () {
    const success = await initAudio();
    if (!success) return;

    document.getElementById("sampleRate").textContent = getSampleRate() + " Hz";


    running = true;
    frozen = false;
    singleTriggered = false;
    audioBuffer = [];

    setRunningState();


    draw();
};



btnStop.onclick = function () {
    running = false;
    stopAudio();
    setStoppedState();
};



document.getElementById("btnFreeze").onclick = function () {
    frozen = !frozen;
    document.getElementById("btnFreeze").textContent = frozen ? "▶ Unfreeze" : "⏸ Freeze";
    statusText.textContent = frozen ? "Frozen" : "Running";
};


document.getElementById("btnScreenshot").onclick = saveScreenshot;
document.getElementById("btnSaveCSV").onclick = saveCSV;
document.getElementById("btnSaveWAV").onclick = saveWAV;



function draw() {

    if (!running) return;


    requestAnimationFrame(draw);


    if (frozen) return;


    const timeDomain = getTimeDomainData();
    const freqDomain = getFrequencyData();
    const floatData = getFloatTimeDomainData();

    if (!timeDomain || !freqDomain) return;


    lastWaveform = timeDomain;
    lastFreqData = freqDomain;


    if (floatData) {
        storeAudioBuffer(floatData);
    }


    const trigIndex = findTrigger(timeDomain);


    const trigResult = checkTriggerMode(trigIndex, singleTriggered);
    singleTriggered = trigResult.singleTriggered;

    if (!trigResult.shouldUpdate) return;

    if (singleTriggered && document.getElementById("trigMode").value === "single") {
        statusText.textContent = "Triggered (Single)";
    }


    computeMeasurements(timeDomain);


    if (viewMode === "time" || viewMode === "both") {
        drawWaveform(timeDomain, trigIndex);
    }


    if (viewMode === "fft" || viewMode === "both") {
        drawFFT(freqDomain);
    }
}

//audio.js

let audioCtx = null;
let analyser = null;
let micStream = null;
let sourceNode = null;
let audioBuffer = [];


const FFT_SIZE = 8192;


async function initAudio() {
    try {

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();


        micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });


        sourceNode = audioCtx.createMediaStreamSource(micStream);


        analyser = audioCtx.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = 0.3;

        sourceNode.connect(analyser);

        return true;
    } catch (error) {
        console.error("Audio initialization failed:", error);
        alert("Microphone access denied or error:\n" + error.message);
        return false;
    }
}


function stopAudio() {
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }
    if (audioCtx) {
        audioCtx.close();
        audioCtx = null;
    }
    analyser = null;
    sourceNode = null;
}


function getTimeDomainData() {
    if (!analyser) return null;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    return data;
}


function getFrequencyData() {
    if (!analyser) return null;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    return data;
}


function getFloatTimeDomainData() {
    if (!analyser) return null;
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    return data;
}


function storeAudioBuffer(floatData) {
    audioBuffer.push(...floatData);
    const maxSamples = audioCtx ? audioCtx.sampleRate * 10 : 441000;
    if (audioBuffer.length > maxSamples) {
        audioBuffer = audioBuffer.slice(-maxSamples);
    }
}


function getSampleRate() {
    return audioCtx ? audioCtx.sampleRate : 44100;
}
//trigger.js

function findTrigger(data) {
    const mode = document.getElementById("trigMode").value;
    const edge = document.getElementById("trigEdge").value;
    const thresholdPercent = +document.getElementById("trigThreshold").value;
    const threshold = Math.round((thresholdPercent / 100) * 255);


    for (let i = 1; i < data.length - 1; i++) {
        if (edge === "rising" && data[i - 1] < threshold && data[i] >= threshold) {
            return i;
        }
        if (edge === "falling" && data[i - 1] > threshold && data[i] <= threshold) {
            return i;
        }
    }


    return mode === "auto" ? 0 : -1;
}


function checkTriggerMode(trigIndex, singleTriggered) {
    const mode = document.getElementById("trigMode").value;

    if (mode === "normal" && trigIndex === -1) {
        return { shouldUpdate: false, singleTriggered: singleTriggered };
    }

    if (mode === "single") {
        if (singleTriggered) {
            return { shouldUpdate: false, singleTriggered: true };
        }
        if (trigIndex === -1) {
            return { shouldUpdate: false, singleTriggered: false };
        }
        return { shouldUpdate: true, singleTriggered: true };
    }

    return { shouldUpdate: true, singleTriggered: singleTriggered };
}


function acCouple(data) {

    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i];
    }
    const dcOffset = sum / data.length;


    const output = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
        const centered = data[i] - dcOffset + 128;
        output[i] = Math.max(0, Math.min(255, Math.round(centered)));
    }
    return output;
}
//drawing.js

const scopeCanvas = document.getElementById("scopeCanvas");
const fftCanvas = document.getElementById("fftCanvas");
const sctx = scopeCanvas.getContext("2d");
const fctx = fftCanvas.getContext("2d");


function drawGrid(ctx, w, h) {
    const bright = +document.getElementById("gridBright").value;
    const alpha = (bright / 100).toFixed(2);


    ctx.strokeStyle = `rgba(0,255,0,${alpha * 0.35})`;
    ctx.lineWidth = 0.5;

    const divX = 10;
    const divY = 8;


    for (let i = 0; i <= divX; i++) {
        const x = (w / divX) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }


    for (let i = 0; i <= divY; i++) {
        const y = (h / divY) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }


    ctx.strokeStyle = `rgba(0,255,0,${alpha * 0.7})`;
    ctx.lineWidth = 1;


    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();


    ctx.strokeStyle = `rgba(0,255,0,${alpha * 0.5})`;

    for (let i = 0; i < w; i += w / 50) {
        ctx.beginPath();
        ctx.moveTo(i, h / 2 - 3);
        ctx.lineTo(i, h / 2 + 3);
        ctx.stroke();
    }

    for (let i = 0; i < h; i += h / 40) {
        ctx.beginPath();
        ctx.moveTo(w / 2 - 3, i);
        ctx.lineTo(w / 2 + 3, i);
        ctx.stroke();
    }
}


function drawTriggerLine(ctx, w, h) {
    const thresholdPercent = +document.getElementById("trigThreshold").value;
    const y = h - (thresholdPercent / 100) * h;

    ctx.strokeStyle = "rgba(255,100,0,0.6)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();

    ctx.setLineDash([]);


    ctx.fillStyle = "#f60";
    ctx.font = "10px Arial";
    ctx.fillText("T", 4, y - 4);
}

function drawWaveform(data, trigIndex) {
    const w = scopeCanvas.width = scopeCanvas.clientWidth;
    const h = scopeCanvas.height;

    const persist = +document.getElementById("persistence").value / 100;
    const timeScale = +document.getElementById("timeDiv").value;
    const hPos = +document.getElementById("hPos").value;
    const volts = +document.getElementById("voltsDiv").value / 50;
    const vOff = +document.getElementById("vOffset").value;
    const coupling = document.getElementById("coupling").value;
    const color = document.getElementById("traceColor").value;
    const lw = +document.getElementById("lineWidth").value;


    if (persist > 0) {
        sctx.fillStyle = `rgba(0,0,0,${1 - persist})`;
    } else {
        sctx.fillStyle = "#000";
    }
    sctx.fillRect(0, 0, w, h);


    drawGrid(sctx, w, h);
    drawTriggerLine(sctx, w, h);


    let processedData = data;
    if (coupling === "ac") {
        processedData = acCouple(data);
    }

    const startIdx = Math.max(0, (trigIndex !== -1 ? trigIndex : 0) + Math.round(hPos));

    sctx.shadowColor = color;
    sctx.shadowBlur = 8;
    sctx.strokeStyle = color;
    sctx.lineWidth = lw;
    sctx.beginPath();

    for (let x = 0; x < w; x++) {
        const dataIdx = startIdx + Math.round(x * timeScale);
        const idx = dataIdx % processedData.length;
        const val = processedData[idx] / 255;
        const y = h / 2 - (val - 0.5) * h * volts + vOff;

        if (x === 0) {
            sctx.moveTo(x, y);
        } else {
            sctx.lineTo(x, y);
        }
    }

    sctx.stroke();
    sctx.shadowBlur = 0;

    sctx.fillStyle = "#0f0";
    sctx.font = "11px monospace";
    sctx.fillText("CH1 - MIC", 10, 16);
    sctx.fillText(timeScale.toFixed(1) + " ms/div", w - 100, 16);
}


function drawFFT(freqData) {
    const w = fftCanvas.width = fftCanvas.clientWidth;
    const h = fftCanvas.height;


    const persist = +document.getElementById("persistence").value / 100;
    const color = document.getElementById("traceColor").value;


    if (persist > 0) {
        fctx.fillStyle = `rgba(0,0,0,${1 - persist})`;
    } else {
        fctx.fillStyle = "#000";
    }
    fctx.fillRect(0, 0, w, h);


    drawGrid(fctx, w, h);


    fctx.shadowColor = color;
    fctx.shadowBlur = 4;
    fctx.strokeStyle = color;
    fctx.lineWidth = 1.5;
    fctx.beginPath();

    const maxFreq = getSampleRate() / 2;

    for (let x = 0; x < w; x++) {

        const ratio = x / w;
        const logIdx = Math.pow(ratio, 2) * freqData.length;
        const idx = Math.min(Math.floor(logIdx), freqData.length - 1);
        const val = freqData[idx] / 255;
        const y = h - val * h;

        if (x === 0) {
            fctx.moveTo(x, y);
        } else {
            fctx.lineTo(x, y);
        }
    }

    fctx.stroke();
    fctx.shadowBlur = 0;


    drawFrequencyLabels(fctx, w, h, maxFreq);
}

function drawFrequencyLabels(ctx, w, h, maxFreq) {
    ctx.fillStyle = "#0f0";
    ctx.font = "10px monospace";

    const freqs = [100, 200, 500, 1000, 2000, 5000, 10000, 20000];

    freqs.forEach(f => {
        if (f > maxFreq) return;
        const ratio = Math.sqrt(f / maxFreq);
        const x = ratio * w;


        const label = f >= 1000 ? (f / 1000) + "k" : f + "";
        ctx.fillText(label, x, h - 4);


        ctx.strokeStyle = "rgba(0,255,0,0.15)";
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    });

    ctx.fillText("FFT SPECTRUM", 10, 14);
}

//export.js 

let lastWaveform = null;
let lastFreqData = null;


function saveScreenshot() {
    const canvas = viewMode === "fft" ? fftCanvas : scopeCanvas;

    const link = document.createElement("a");
    link.download = "oscilloscope_" + Date.now() + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
}

function saveCSV() {
    if (!lastWaveform) {
        alert("No data to save. Start the oscilloscope first.");
        return;
    }

    const sampleRate = getSampleRate();
    let csv = "sample,time_ms,amplitude,amplitude_percent\n";

    for (let i = 0; i < lastWaveform.length; i++) {
        const timeMs = (i / sampleRate * 1000).toFixed(4);
        const ampPercent = ((lastWaveform[i] / 255) * 100).toFixed(2);
        csv += `${i},${timeMs},${lastWaveform[i]},${ampPercent}\n`;
    }

    downloadFile(csv, "text/csv", "waveform_" + Date.now() + ".csv");
}


function saveWAV() {
    if (audioBuffer.length === 0) {
        alert("No audio data. Start the oscilloscope first.");
        return;
    }

    const sampleRate = getSampleRate();
    const numSamples = audioBuffer.length;
    const wavBuffer = createWAVBuffer(audioBuffer, sampleRate, numSamples);

    const blob = new Blob([wavBuffer], { type: "audio/wav" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "recording_" + Date.now() + ".wav";
    link.click();
}


function createWAVBuffer(samples, sampleRate, numSamples) {
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);


    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(view, 8, "WAVE");

    // Format chunk
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);


    writeString(view, 36, "data");
    view.setUint32(40, numSamples * 2, true);


    for (let i = 0; i < numSamples; i++) {
        let sample = Math.max(-1, Math.min(1, samples[i]));
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(44 + i * 2, int16, true);
    }

    return buffer;
}


function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}


function downloadFile(data, type, filename) {
    const blob = new Blob([data], { type: type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}
//measurement.js

function computeMeasurements(data) {
    if (!data || data.length === 0) return;

    let min = 255;
    let max = 0;
    let sum = 0;
    let sqSum = 0;


    for (let i = 0; i < data.length; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
        sum += data[i];
        sqSum += data[i] * data[i];
    }

    const avg = sum / data.length;
    const rms = Math.sqrt(sqSum / data.length);
    const vpp = max - min;


    const freq = estimateFrequency(data, avg);


    updateMeasurementDisplay(freq, vpp, rms, max, min, avg);
}


function estimateFrequency(data, average) {
    let crossings = 0;

    for (let i = 1; i < data.length; i++) {

        if (data[i - 1] < average && data[i] >= average) {
            crossings++;
        }
    }

    const sampleRate = getSampleRate();

    if (crossings > 0) {
        return (crossings * sampleRate) / (2 * data.length);
    }

    return 0;
}


function updateMeasurementDisplay(freq, vpp, rms, max, min, avg) {
    document.getElementById("mFreq").textContent =
        freq > 0 ? freq.toFixed(1) + " Hz" : "-- Hz";

    document.getElementById("mPeriod").textContent =
        freq > 0 ? (1000 / freq).toFixed(2) + " ms" : "-- ms";

    document.getElementById("mVpp").textContent =
        ((vpp / 255) * 100).toFixed(1) + "%";

    document.getElementById("mVrms").textContent =
        ((rms / 255) * 100).toFixed(1) + "%";

    document.getElementById("mVmax").textContent =
        ((max / 255) * 100).toFixed(1) + "%";

    document.getElementById("mVmin").textContent =
        ((min / 255) * 100).toFixed(1) + "%";

    document.getElementById("mDC").textContent =
        ((avg / 255) * 100).toFixed(1) + "%";
}
