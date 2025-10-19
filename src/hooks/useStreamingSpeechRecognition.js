import { useState, useRef, useCallback, useEffect } from 'react';
import { useModelStatus } from './useModelStatus';

/**
 * 流式语音识别Hook
 * 提供实时流式语音识别功能，边说边显示识别结果
 */
export const useStreamingSpeechRecognition = () => {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [error, setError] = useState(null);
  const [confidence, setConfidence] = useState(0);

  // 音频处理相关引用
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const recognitionChunksRef = useRef([]);
  const silenceTimerRef = useRef(null);

  // 流式识别相关
  const streamingIntervalRef = useRef(null);
  const lastRecognitionTimeRef = useRef(0);
  const audioChunkBufferRef = useRef([]);

  // 使用模型状态Hook
  const modelStatus = useModelStatus();

  // 音频活动检测
  const detectAudioActivity = useCallback(() => {
    if (!analyserRef.current) return false;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // 计算平均音量
    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
    const normalizedVolume = average / 255;

    return normalizedVolume > 0.05; // 5% 音量阈值
  }, []);

  // 发送音频块进行识别
  const recognizeAudioChunk = useCallback(async (audioBlob) => {
    if (!audioBlob || audioBlob.size < 1024) return; // 忽略太小的音频块

    try {
      console.log("🎵 处理音频块:", audioBlob.size, "bytes");

      // 转换为WAV格式
      const wavBlob = await convertToWav(audioBlob);

      if (window.electronAPI) {
        const arrayBuffer = await wavBlob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // 发送识别请求
        const result = await window.electronAPI.transcribeAudio(uint8Array);

        if (result.success && result.text && result.text.trim()) {
          const now = Date.now();

          // 更新最终文本（流式累加）
          setFinalText(prev => {
            const newText = prev + (prev ? '' : '') + result.text;
            console.log("📝 流式识别结果:", newText);
            return newText;
          });

          setConfidence(result.confidence || 0);
          lastRecognitionTimeRef.current = now;

          // 清除中间文本
          setInterimText('');

          // 实时复制到剪贴板（可选）
          if (window.electronAPI && window.electronAPI.copyToClipboard) {
            window.electronAPI.copyToClipboard(result.text);
          }
        }
      }
    } catch (err) {
      console.error("音频块识别失败:", err);
    }
  }, []);

  // 转换音频格式为WAV
  const convertToWav = useCallback(async (audioBlob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const arrayBuffer = reader.result;
          const audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000
          });

          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          const wavBuffer = audioBufferToWav(audioBuffer);
          const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

          audioContext.close();
          resolve(wavBlob);
        } catch (err) {
          reject(new Error(`音频格式转换失败: ${err.message}`));
        }
      };

      reader.onerror = () => {
        reject(new Error('读取音频文件失败'));
      };

      reader.readAsArrayBuffer(audioBlob);
    });
  }, []);

  // AudioBuffer转WAV格式
  const audioBufferToWav = (audioBuffer) => {
    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    const numberOfChannels = audioBuffer.numberOfChannels;
    const bytesPerSample = 2;
    const blockAlign = numberOfChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const bufferSize = 44 + dataSize;

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // WAV文件头
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // 音频数据
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
        view.setInt16(offset, sample * 0x7FFF, true);
        offset += 2;
      }
    }

    return buffer;
  };

  // 启动流式识别
  const startStreamingRecognition = useCallback(async () => {
    try {
      setError(null);
      setInterimText('');
      setFinalText('');

      // 检查FunASR是否就绪
      if (!modelStatus.isReady) {
        if (modelStatus.isLoading) {
          throw new Error('FunASR服务器正在启动中，请稍候...');
        } else if (modelStatus.error) {
          throw new Error('FunASR服务器未就绪，请检查配置');
        } else {
          throw new Error('正在准备FunASR服务器，请稍候...');
        }
      }

      // 检查浏览器支持
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('您的浏览器不支持录音功能');
      }

      // 请求麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      streamRef.current = stream;

      // 创建音频上下文和分析器
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;

      // 创建MediaRecorder用于录制音频块
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorderRef.current = mediaRecorder;

      // 收集音频数据块
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunkBufferRef.current.push(event.data);
        }
      };

      // 启动流式识别循环
      const startStreamingLoop = () => {
        console.log("🎵 启动流式识别循环");

        streamingIntervalRef.current = setInterval(async () => {
          if (audioChunkBufferRef.current.length > 0) {
            // 合并音频块
            const audioChunks = [...audioChunkBufferRef.current];
            audioChunkBufferRef.current = [];

            if (audioChunks.length > 0) {
              const combinedBlob = new Blob(audioChunks, {
                type: 'audio/webm;codecs=opus'
              });

              await recognizeAudioChunk(combinedBlob);
            }
          }
        }, 1500); // 每1.5秒处理一次音频块
      };

      // 开始录制（每秒收集一次数据）
      mediaRecorder.start(1000);
      setIsListening(true);

      // 延迟启动流式处理，避免初始静音
      setTimeout(startStreamingLoop, 2000);

      console.log("🎤 流式语音识别已启动");

      // 设置静音检测自动停止
      const checkSilence = () => {
        if (!detectAudioActivity()) {
          // 检测到静音，启动静音计时器
          silenceTimerRef.current = setTimeout(() => {
            console.log("🔇 检测到长时间静音，自动停止流式识别");
            stopStreamingRecognition();
          }, 5000); // 5秒静音后自动停止
        } else {
          // 有声音，清除静音计时器
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        }
      };

      // 定期检测静音
      const silenceCheckInterval = setInterval(checkSilence, 1000);
      recognitionChunksRef.current.push(silenceCheckInterval);

    } catch (err) {
      setError(`无法启动流式语音识别: ${err.message}`);
      setIsListening(false);
    }
  }, [modelStatus.isReady, modelStatus.isLoading, modelStatus.error, detectAudioActivity, recognizeAudioChunk]);

  // 停止流式识别
  const stopStreamingRecognition = useCallback(() => {
    console.log("⏹️ 停止流式语音识别");

    setIsListening(false);
    setIsProcessing(true);

    // 清理定时器
    if (streamingIntervalRef.current) {
      clearInterval(streamingIntervalRef.current);
      streamingIntervalRef.current = null;
    }

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // 清理静音检测定时器
    recognitionChunksRef.current.forEach(timer => {
      clearInterval(timer);
    });
    recognitionChunksRef.current = [];

    // 处理剩余的音频块
    if (audioChunkBufferRef.current.length > 0) {
      const processRemainingChunks = async () => {
        const audioChunks = [...audioChunkBufferRef.current];
        audioChunkBufferRef.current = [];

        if (audioChunks.length > 0) {
          const combinedBlob = new Blob(audioChunks, {
            type: 'audio/webm;codecs=opus'
          });
          await recognizeAudioChunk(combinedBlob);
        }
        setIsProcessing(false);
      };

      processRemainingChunks();
    } else {
      setIsProcessing(false);
    }

    // 停止录制
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    // 停止音频流
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // 清理音频上下文
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    console.log("✅ 流式语音识别已停止，最终文本:", finalText);
  }, [recognizeAudioChunk, finalText]);

  // 清理资源
  useEffect(() => {
    return () => {
      stopStreamingRecognition();
    };
  }, [stopStreamingRecognition]);

  // 手动清除文本
  const clearText = useCallback(() => {
    setFinalText('');
    setInterimText('');
    setConfidence(0);
  }, []);

  return {
    isListening,
    isProcessing,
    interimText,
    finalText,
    error,
    confidence,
    startStreamingRecognition,
    stopStreamingRecognition,
    clearText
  };
};