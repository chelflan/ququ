import { useState, useRef, useCallback, useEffect } from 'react';
import { useModelStatus } from './useModelStatus';

/**
 * 录音功能Hook
 * 提供录音、停止录音、音频处理等功能
 */
export const useRecording = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState(null);
  const [audioData, setAudioData] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);

  // 添加防重复处理机制
  const processingRef = useRef({ isProcessingAudio: false, lastProcessTime: 0 });

  // 声音结束检测相关引用
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const animationFrameRef = useRef(null);
  const silenceDetectorRef = useRef({
    silenceStartTime: null,
    isBelowThreshold: false,
    checkInterval: null
  });

  // 使用模型状态Hook
  const modelStatus = useModelStatus();

  // 启动声音结束检测
  const startSilenceDetection = useCallback(async () => {
    if (!streamRef.current || audioContextRef.current) return;

    try {
      console.log("🔇 启动声音结束检测（针对语音识别优化）");

      // 获取语音检测设置 - 调整为更适合语音识别的参数
      let silenceThreshold = 0.05; // 降低到5%，避免误判正常的语音停顿
      let silenceDuration = 2000; // 增加到2秒，给用户更充分的说话时间

      if (window.electronAPI) {
        try {
          const threshold = await window.electronAPI.getSetting('voice_threshold', 20);
          const duration = await window.electronAPI.getSetting('silence_duration', 2000); // 默认2秒
          silenceThreshold = threshold / 100; // 转换为小数
          silenceDuration = duration;
          console.log(`📋 加载静音检测配置: 阈值${(silenceThreshold * 100).toFixed(0)}%, 持续${silenceDuration}ms`);
        } catch (error) {
          console.error("获取静音检测设置失败，使用默认值:", error);
        }
      }

      // 创建音频上下文和分析器
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      const source = audioContext.createMediaStreamSource(streamRef.current);
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;

      // 重置静音检测器
      silenceDetectorRef.current = {
        silenceStartTime: null,
        isBelowThreshold: false,
        checkInterval: null
      };

      // 音量监测循环 - 增加更严格的静音检测逻辑
      const monitorVolume = () => {
        if (!analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // 计算平均音量
        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        const normalizedVolume = average / 255; // 归一化到0-1
        const volumePercent = (normalizedVolume * 100).toFixed(1);

        const isBelowThreshold = normalizedVolume < silenceThreshold;
        const now = Date.now();

        // 每1秒记录一次音量状态，减少日志频率
        if (now % 1000 < 100) {
          const status = isBelowThreshold ? '🔇 静音' : '🎤 有声音';
          const silenceInfo = silenceDetectorRef.current.silenceStartTime
            ? `静音时长: ${now - silenceDetectorRef.current.silenceStartTime}ms`
            : '无静音检测';
          console.log(`🔇 录音音量监测: ${volumePercent}% | 阈值: ${(silenceThreshold * 100).toFixed(0)}% | ${status} | ${silenceInfo}`);
        }

        if (isBelowThreshold) {
          // 当前是静音
          if (!silenceDetectorRef.current.isBelowThreshold) {
            // 刚进入静音状态
            silenceDetectorRef.current.silenceStartTime = now;
            silenceDetectorRef.current.isBelowThreshold = true;
            console.log(`🔇 检测到静音开始 (${volumePercent}% < ${(silenceThreshold * 100).toFixed(0)}%)`);
          } else if (silenceDetectorRef.current.silenceStartTime &&
                     (now - silenceDetectorRef.current.silenceStartTime) >= silenceDuration) {
            // 静音持续时间足够，自动停止录音
            const totalSilenceTime = now - silenceDetectorRef.current.silenceStartTime;
            console.log(`🏁 静音超过${silenceDuration}ms，自动停止录音`);
            console.log(`📊 静音检测统计:`);
            console.log(`   - 静音时长: ${totalSilenceTime}ms (要求: ${silenceDuration}ms)`);
            console.log(`   - 音量: ${volumePercent}% (阈值: ${(silenceThreshold * 100).toFixed(0)}%)`);

            // 额外的安全检查：确保录音时间不少于1秒，避免误触发
            const recordingStartTime = Date.now() - (mediaRecorderRef.current?.startTime || Date.now());
            const minRecordingTime = 1000; // 最少录音1秒

            if (recordingStartTime >= minRecordingTime) {
              console.log(`✅ 录音时长检查通过 (${recordingStartTime}ms >= ${minRecordingTime}ms)，可以停止录音`);
              stopSilenceDetection();
              // 直接停止MediaRecorder，避免递归调用stopRecording
              if (mediaRecorderRef.current) {
                mediaRecorderRef.current.stop();
              }
            } else {
              console.log(`⚠️ 录音时间过短 (${recordingStartTime}ms < ${minRecordingTime}ms)，继续录音`);
              // 重置静音检测，继续录音
              silenceDetectorRef.current.silenceStartTime = now;
              silenceDetectorRef.current.isBelowThreshold = false;
            }
            return;
          }
        } else {
          // 当前有声音，重置静音检测
          if (silenceDetectorRef.current.isBelowThreshold) {
            const silenceDuration = now - (silenceDetectorRef.current.silenceStartTime || now);
            console.log(`🎤 声音恢复 (${volumePercent}% >= ${(silenceThreshold * 100).toFixed(0)}%)，静音时长: ${silenceDuration}ms`);
          }

          silenceDetectorRef.current.silenceStartTime = null;
          silenceDetectorRef.current.isBelowThreshold = false;
        }

        animationFrameRef.current = requestAnimationFrame(monitorVolume);
      };

      monitorVolume();

    } catch (error) {
      console.error("❌ 声音结束检测启动失败:", error);
    }
  }, []);

  // 停止声音结束检测
  const stopSilenceDetection = useCallback(() => {
    console.log("⏹️ 停止声音结束检测");

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;

    // 重置静音检测器
    silenceDetectorRef.current = {
      silenceStartTime: null,
      isBelowThreshold: false,
      checkInterval: null
    };
  }, []);

  // 开始录音 - 支持预录音数据和模式区分
  const startRecording = useCallback(async (preRecordAudioData = null, isAutoMode = false) => {
    try {
      setError(null);

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

      // 保存预录音数据（如果有）
      if (preRecordAudioData) {
        console.log("📼 接收到预录音数据:", preRecordAudioData.length, "采样点");
        audioChunksRef.current = { preRecord: preRecordAudioData, recorded: [] };
      } else {
        audioChunksRef.current = [];
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

      // 创建MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorderRef.current = mediaRecorder;
      // 记录录音开始时间，用于计算录音时长
      mediaRecorder.startTime = Date.now();

      // 设置事件处理器
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          if (audioChunksRef.current.preRecord) {
            audioChunksRef.current.recorded.push(event.data);
          } else {
            audioChunksRef.current.push(event.data);
          }
        }
      };

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        setIsProcessing(true);

        try {
          // 创建音频Blob
          const recordedBlob = new Blob(
            audioChunksRef.current.preRecord ? audioChunksRef.current.recorded : audioChunksRef.current,
            { type: 'audio/webm;codecs=opus' }
          );

          setAudioData(recordedBlob);

          // 处理音频（包含预录音数据）
          await processAudio(recordedBlob, audioChunksRef.current.preRecord);
        } catch (err) {
          setError(`音频处理失败: ${err.message}`);
        } finally {
          setIsProcessing(false);
        }
      };

      mediaRecorder.onerror = (event) => {
        setError(`录音错误: ${event.error?.message || '未知错误'}`);
        setIsRecording(false);
        setIsProcessing(false);
      };

      // 开始录音
      mediaRecorder.start(1000); // 每秒收集一次数据
      setIsRecording(true);

      console.log(`🎤 开始${isAutoMode ? '自动' : '手动'}录音${preRecordAudioData ? '（包含预录音数据）' : ''}`);

      // 只有在自动模式下才启动声音结束检测
      if (isAutoMode) {
        setTimeout(() => {
          startSilenceDetection();
        }, 200); // 延迟200ms启动检测，避免立即检测到静音
        console.log("🔇 自动模式：已启用静音检测");
      } else {
        console.log("🎯 手动模式：录音将持续直到用户手动停止");
      }

    } catch (err) {
      setError(`无法开始录音: ${err.message}`);
      setIsRecording(false);
    }
  }, [modelStatus.isReady, modelStatus.isLoading, modelStatus.error, startSilenceDetection]);

  // 停止录音
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      // 先停止声音结束检测
      stopSilenceDetection();

      mediaRecorderRef.current.stop();

      // 停止所有音频轨道
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    }
  }, [isRecording, stopSilenceDetection]);

  // 智能音频质量检测 - 分析音频是否包含真实的人声
  const analyzeAudioQuality = useCallback(async (audioBlob) => {
    try {
      console.log("🔍 开始智能音频质量分析...");

      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const duration = audioBuffer.duration;

      console.log(`📊 音频基本信息: 时长${duration.toFixed(2)}s, 采样率${sampleRate}Hz, 采样点${channelData.length}`);

      // 1. 计算RMS音量（Root Mean Square）
      let sum = 0;
      for (let i = 0; i < channelData.length; i++) {
        sum += channelData[i] * channelData[i];
      }
      const rms = Math.sqrt(sum / channelData.length);
      const rmsDb = 20 * Math.log10(rms + 1e-10); // 转换为分贝

      console.log(`🔊 RMS音量: ${rms.toFixed(4)} (${rmsDb.toFixed(1)}dB)`);

      // 2. 计算零交叉率（Zero Crossing Rate）- 人声通常有较高的零交叉率
      let zeroCrossings = 0;
      for (let i = 1; i < channelData.length; i++) {
        if ((channelData[i] >= 0) !== (channelData[i-1] >= 0)) {
          zeroCrossings++;
        }
      }
      const zcr = zeroCrossings / (channelData.length - 1) * sampleRate;
      console.log(`📈 零交叉率: ${zcr.toFixed(1)} 次/秒`);

      // 3. 计算频谱重心（Spectral Centroid）- 人声通常在特定频段
      const fftSize = 2048;
      const fft = new Float32Array(fftSize);

      // 简化的频谱分析
      let spectralCentroid = 0;
      let spectralEnergy = 0;

      for (let i = 0; i < Math.min(channelData.length, fftSize); i++) {
        const magnitude = Math.abs(channelData[i]);
        const frequency = (i * sampleRate) / fftSize;
        spectralCentroid += magnitude * frequency;
        spectralEnergy += magnitude;
      }

      if (spectralEnergy > 0) {
        spectralCentroid /= spectralEnergy;
      }
      console.log(`🎵 频谱重心: ${spectralCentroid.toFixed(1)}Hz`);

      // 4. 计算动态范围（Dynamic Range）
      let maxSample = 0;
      let minSample = 0;
      for (let i = 0; i < channelData.length; i++) {
        maxSample = Math.max(maxSample, channelData[i]);
        minSample = Math.min(minSample, channelData[i]);
      }
      const dynamicRange = maxSample - minSample;
      console.log(`📏 动态范围: ${dynamicRange.toFixed(4)}`);

      // 5. 检测是否有持续的音频活动（不是瞬间噪音）
      const frameSize = Math.floor(sampleRate * 0.01); // 10ms帧
      const frameCount = Math.floor(channelData.length / frameSize);
      let activeFrames = 0;

      const activityThreshold = 0.01; // 音量阈值

      for (let frame = 0; frame < frameCount; frame++) {
        let frameEnergy = 0;
        for (let i = 0; i < frameSize; i++) {
          const sample = channelData[frame * frameSize + i];
          frameEnergy += sample * sample;
        }
        frameEnergy = Math.sqrt(frameEnergy / frameSize);

        if (frameEnergy > activityThreshold) {
          activeFrames++;
        }
      }

      const activityRatio = activeFrames / frameCount;
      console.log(`⏱️ 音频活动比例: ${(activityRatio * 100).toFixed(1)}%`);

      audioContext.close();

      // 智能评分系统
      let score = 0;
      let reasons = [];

      // 音量评分 (25分) - 更宽松的音量要求
      if (rmsDb > -35) {
        score += 25;
        reasons.push("音量充足");
      } else if (rmsDb > -45) {
        score += 18;
        reasons.push("音量适中");
      } else if (rmsDb > -55) {
        score += 10;
        reasons.push("音量偏低");
      } else {
        reasons.push("音量过低");
      }

      // 零交叉率评分 (30分) - 扩大人声范围，包括轻声说话
      if (zcr > 300 && zcr < 2500) {
        score += 30;
        reasons.push("零交叉率正常");
      } else if (zcr > 150 && zcr < 3500) {
        score += 20;
        reasons.push("零交叉率可接受");
      } else if (zcr > 50 && zcr < 4000) {
        score += 10;
        reasons.push("零交叉率勉强");
      } else {
        reasons.push("零交叉率异常");
      }

      // 频谱重心评分 (25分) - 扩大人声频率范围
      if (spectralCentroid > 400 && spectralCentroid < 2500) {
        score += 25;
        reasons.push("频谱重心合适");
      } else if (spectralCentroid > 200 && spectralCentroid < 3500) {
        score += 18;
        reasons.push("频谱重心可接受");
      } else if (spectralCentroid > 100 && spectralCentroid < 4500) {
        score += 10;
        reasons.push("频谱重心勉强");
      } else {
        reasons.push("频谱重心异常");
      }

      // 活动比例评分 (20分) - 降低活动比例要求
      if (activityRatio > 0.3) {
        score += 20;
        reasons.push("音频活动充分");
      } else if (activityRatio > 0.2) {
        score += 12;
        reasons.push("音频活动一般");
      } else if (activityRatio > 0.1) {
        score += 5;
        reasons.push("音频活动较少");
      } else {
        reasons.push("音频活动不足");
      }

      const isLikelySpeech = score >= 45; // 降低到45分，更加宽容，减少误判

      console.log(`🎯 音频质量评分: ${score}/100`);
      console.log(`📝 评分原因: ${reasons.join(", ")}`);
      console.log(`${isLikelySpeech ? '✅' : '❌'} ${isLikelySpeech ? '检测到人声特征' : '可能是噪音或静音'}`);

      return {
        isLikelySpeech,
        score,
        reasons,
        details: {
          rmsDb,
          zeroCrossingRate: zcr,
          spectralCentroid,
          dynamicRange,
          activityRatio,
          duration
        }
      };

    } catch (error) {
      console.error("❌ 音频质量分析失败:", error);
      return { isLikelySpeech: true, score: 50, reasons: ["分析失败，默认通过"] }; // 分析失败时默认通过
    }
  }, []);

  // 处理音频 - 支持预录音数据合并和智能质量检测
  const processAudio = useCallback(async (audioBlob, preRecordAudioData = null) => {
    processingRef.current.isProcessingAudio = true;

    try {
      let finalAudioBlob = audioBlob;

      // 如果有预录音数据，需要合并音频
      if (preRecordAudioData && preRecordAudioData.length > 0) {
        console.log("🔄 开始合并预录音和实际录音数据");
        finalAudioBlob = await mergeAudioData(preRecordAudioData, audioBlob);
        console.log("✅ 音频合并完成");
      }

      const wavBlob = await convertToWav(finalAudioBlob);

      // 智能音频质量检测
      const qualityAnalysis = await analyzeAudioQuality(wavBlob);

      // 如果音频质量太差，可能是噪音，直接丢弃
      if (!qualityAnalysis.isLikelySpeech) {
        console.log("🚫 音频质量检测未通过，可能是噪音，丢弃处理结果");
        if (window.electronAPI && window.electronAPI.log) {
          window.electronAPI.log('info', '音频质量检测未通过，丢弃噪音录音', `评分: ${qualityAnalysis.score}/100`);
        }
        return { success: false, error: "音频质量检测未通过，可能是噪音", qualityAnalysis };
      }

      console.log("✅ 音频质量检测通过，开始语音识别");

      if (window.electronAPI) {
        const arrayBuffer = await wavBlob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        const transcriptionResult = await window.electronAPI.transcribeAudio(uint8Array);

        if (transcriptionResult.success) {
          const raw_text = transcriptionResult.text;

          // 准备转录数据
          const transcriptionData = {
            raw_text: raw_text,
            text: raw_text, // 初始文本设为原始文本
            confidence: transcriptionResult.confidence || 0,
            language: transcriptionResult.language || 'zh-CN',
            duration: transcriptionResult.duration || 0,
            file_size: uint8Array.length,
            has_pre_record: !!preRecordAudioData, // 标记是否包含预录音
            quality_analysis: qualityAnalysis, // 添加质量分析结果
          };

          // 立即显示初步结果
          if (window.onTranscriptionComplete) {
            window.onTranscriptionComplete({ ...transcriptionResult, enhanced_by_ai: false, has_pre_record: !!preRecordAudioData, quality_analysis: qualityAnalysis });
          }

          // 异步处理AI优化和保存（只保存一次）
          setIsOptimizing(true);
          setTimeout(async () => {
            try {
              // 从设置中读取是否启用AI优化
              const useAI = await window.electronAPI.getSetting('enable_ai_optimization', true);

              let finalData = { ...transcriptionData };

              if (useAI) {
                try {
                  if (window.electronAPI && window.electronAPI.log) {
                    window.electronAPI.log('info', '开始AI文本优化:', raw_text.substring(0, 50) + '...');
                  }

                  const result = await window.electronAPI.processText(raw_text, 'optimize');

                  if (result && result.success) {
                    const processed_text = result.text;
                    finalData.processed_text = processed_text;
                    // 如果AI优化后的文本与原始文本不同，则将优化后的文本作为主文本
                    if (processed_text && processed_text.trim() !== raw_text.trim()) {
                      finalData.text = processed_text;
                    }
                    if (window.electronAPI && window.electronAPI.log) {
                      window.electronAPI.log('info', 'AI文本优化成功', processed_text.substring(0, 50) + '...');
                    }
                  } else {
                    if (window.electronAPI && window.electronAPI.log) {
                      window.electronAPI.log('error', 'AI文本优化失败:', result);
                    }
                  }
                } catch (err) {
                  if (window.electronAPI && window.electronAPI.log) {
                    window.electronAPI.log('error', 'AI文本优化捕获到错误:', err);
                  }
                }
              }

              // 保存转录数据（只保存一次）
              if (window.electronAPI) {
                if (window.electronAPI && window.electronAPI.log) {
                  window.electronAPI.log('info', '准备保存转录数据:', finalData);
                }
                const savedResult = await window.electronAPI.saveTranscription(finalData);
                if (window.electronAPI && window.electronAPI.log) {
                  window.electronAPI.log('info', '转录数据保存成功:', savedResult);
                }

                // 通知UI更新并触发复制操作
                if (useAI && finalData.processed_text && finalData.processed_text !== raw_text) {
                  // 有AI优化结果时
                  const enhancedResult = {
                    ...transcriptionResult,
                    text: finalData.processed_text,
                    processed_text: finalData.processed_text,
                    enhanced_by_ai: true,
                    has_pre_record: !!preRecordAudioData,
                    quality_analysis: qualityAnalysis,
                  };
                  if (window.onAIOptimizationComplete) {
                    window.onAIOptimizationComplete(enhancedResult);
                  }
                } else {
                  // 没有AI优化或AI优化失败时，使用原始文本
                  const finalResult = {
                    ...transcriptionResult,
                    text: raw_text,
                    enhanced_by_ai: false,
                    has_pre_record: !!preRecordAudioData,
                    quality_analysis: qualityAnalysis,
                  };
                  if (window.onAIOptimizationComplete) {
                    window.onAIOptimizationComplete(finalResult);
                  }
                }
              }
            } catch (err) {
              if (window.electronAPI && window.electronAPI.log) {
                window.electronAPI.log('error', '处理和保存转录时出错:', err);
              }
            } finally {
              setIsOptimizing(false);
            }
          }, 100);

          return { ...transcriptionResult, enhanced_by_ai: false, has_pre_record: !!preRecordAudioData, quality_analysis: qualityAnalysis };
        } else {
          throw new Error(transcriptionResult.error || '语音识别失败');
        }
      } else {
        // Web环境模拟
        const mockResult = { success: true, text: '模拟识别结果。', confidence: 0.95, duration: 3.5 };
        if (window.onTranscriptionComplete) window.onTranscriptionComplete({ ...mockResult, has_pre_record: !!preRecordAudioData, quality_analysis: qualityAnalysis });
        return { ...mockResult, has_pre_record: !!preRecordAudioData, quality_analysis: qualityAnalysis };
      }
    } catch (err) {
      throw new Error(`音频处理失败: ${err.message}`);
    } finally {
      processingRef.current.isProcessingAudio = false;
    }
  }, [analyzeAudioQuality]);

  // 合并预录音数据和实际录音数据
  const mergeAudioData = useCallback(async (preRecordFloat32Array, recordedBlob) => {
    try {
      console.log("🔄 开始音频合并...");
      console.log(`   - 预录音数据: ${preRecordFloat32Array.length} 采样点 (${(preRecordFloat32Array.length / 16000).toFixed(2)}s)`);

      // 解码实际录音数据
      const recordedArrayBuffer = await recordedBlob.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const recordedAudioBuffer = await audioContext.decodeAudioData(recordedArrayBuffer);

      console.log(`   - 实际录音: ${recordedAudioBuffer.length} 采样点 (${(recordedAudioBuffer.length / 16000).toFixed(2)}s)`);

      // 计算总长度
      const totalLength = preRecordFloat32Array.length + recordedAudioBuffer.length;
      console.log(`   - 合并后总长度: ${totalLength} 采样点 (${(totalLength / 16000).toFixed(2)}s)`);

      // 创建新的AudioBuffer
      const mergedBuffer = audioContext.createBuffer(1, totalLength, 16000);
      const mergedChannelData = mergedBuffer.getChannelData(0);

      // 复制预录音数据
      for (let i = 0; i < preRecordFloat32Array.length; i++) {
        mergedChannelData[i] = preRecordFloat32Array[i];
      }

      // 复制实际录音数据
      const recordedChannelData = recordedAudioBuffer.getChannelData(0);
      for (let i = 0; i < recordedAudioBuffer.length; i++) {
        mergedChannelData[preRecordFloat32Array.length + i] = recordedChannelData[i];
      }

      // 转换为WAV格式
      const wavBuffer = audioBufferToWav(mergedBuffer);
      const mergedBlob = new Blob([wavBuffer], { type: 'audio/wav' });

      // 关闭AudioContext
      audioContext.close();

      console.log("✅ 音频合并完成");
      return mergedBlob;

    } catch (error) {
      console.error("❌ 音频合并失败:", error);
      // 如果合并失败，返回原始录音数据
      return recordedBlob;
    }
  }, []);

  // 转换音频格式为WAV
  const convertToWav = useCallback(async (audioBlob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const arrayBuffer = reader.result;

          // 创建AudioContext
          const audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000
          });

          // 解码音频数据
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          // 转换为WAV格式
          const wavBuffer = audioBufferToWav(audioBuffer);
          const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

          // 关闭AudioContext释放资源
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

  // 取消录音
  const cancelRecording = useCallback(() => {
    // 停止声音结束检测
    stopSilenceDetection();

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setIsRecording(false);
    setIsProcessing(false);
    setError(null);
    audioChunksRef.current = [];
  }, [stopSilenceDetection]);

  // 获取录音权限状态
  const checkPermissions = useCallback(async () => {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' });
      return result.state; // 'granted', 'denied', 'prompt'
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('warn', '无法检查麦克风权限:', err);
      }
      return 'unknown';
    }
  }, []);

  // 清理资源
  useEffect(() => {
    return () => {
      stopSilenceDetection();
    };
  }, [stopSilenceDetection]);

  return {
    isRecording,
    isProcessing,
    isOptimizing,
    error,
    audioData,
    startRecording,
    stopRecording,
    cancelRecording,
    checkPermissions
  };
};