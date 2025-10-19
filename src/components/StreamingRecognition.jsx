import React, { useState, useEffect } from 'react';
import { Mic, MicOff, Loader2, Volume2, Trash2 } from 'lucide-react';
import { useStreamingSpeechRecognition } from '../hooks/useStreamingSpeechRecognition';

/**
 * 流式语音识别组件
 * 提供实时语音识别界面，边说边显示识别结果
 */
const StreamingRecognition = ({ onClose, onTextUpdate }) => {
  const {
    isListening,
    isProcessing,
    interimText,
    finalText,
    error,
    confidence,
    startStreamingRecognition,
    stopStreamingRecognition,
    clearText
  } = useStreamingSpeechRecognition();

  const [showVolumeIndicator, setShowVolumeIndicator] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);

  // 监听文本变化，通知父组件
  useEffect(() => {
    if (onTextUpdate && finalText) {
      onTextUpdate(finalText);
    }
  }, [finalText, onTextUpdate]);

  // 监听识别状态变化
  useEffect(() => {
    if (isListening) {
      setShowVolumeIndicator(true);
      // 模拟音量变化动画
      const volumeInterval = setInterval(() => {
        setVolumeLevel(Math.random() * 100);
      }, 200);

      return () => {
        clearInterval(volumeInterval);
        setShowVolumeIndicator(false);
        setVolumeLevel(0);
      };
    }
  }, [isListening]);

  const handleToggleListening = () => {
    if (isListening) {
      stopStreamingRecognition();
    } else {
      startStreamingRecognition();
    }
  };

  const handleClear = () => {
    clearText();
  };

  const handleClose = () => {
    if (isListening) {
      stopStreamingRecognition();
    }
    if (onClose) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <div className={`w-3 h-3 rounded-full ${
              isListening ? 'bg-red-500 animate-pulse' : 'bg-gray-400'
            }`} />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 chinese-title">
              流式语音识别
            </h2>
            {isProcessing && (
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleClear}
              disabled={!finalText}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="清除文本"
            >
              <Trash2 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>

            <button
              onClick={handleClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="关闭"
            >
              <span className="text-gray-500 dark:text-gray-400 text-xl">×</span>
            </button>
          </div>
        </div>

        {/* 识别状态指示器 */}
        <div className="p-6 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-center space-x-4">
            {/* 音量指示器 */}
            {showVolumeIndicator && (
              <div className="flex items-center space-x-2">
                <Volume2 className="w-5 h-5 text-blue-500" />
                <div className="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-200"
                    style={{ width: `${volumeLevel}%` }}
                  />
                </div>
              </div>
            )}

            {/* 状态文本 */}
            <div className="text-center">
              {isListening && (
                <p className="text-blue-600 dark:text-blue-400 font-medium">
                  🎤 正在听取您的声音...
                </p>
              )}
              {isProcessing && (
                <p className="text-orange-600 dark:text-orange-400 font-medium">
                  ⚡ 正在处理音频...
                </p>
              )}
              {!isListening && !isProcessing && finalText && (
                <p className="text-green-600 dark:text-green-400 font-medium">
                  ✅ 识别完成
                </p>
              )}
              {!isListening && !isProcessing && !finalText && (
                <p className="text-gray-600 dark:text-gray-400">
                  准备开始语音识别
                </p>
              )}
            </div>

            {/* 置信度指示器 */}
            {confidence > 0 && (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                置信度: {Math.round(confidence * 100)}%
              </div>
            )}
          </div>
        </div>

        {/* 识别结果显示区域 */}
        <div className="flex-1 p-6 overflow-y-auto" style={{ maxHeight: '400px' }}>
          {error && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-red-700 dark:text-red-300 text-sm">
                ❌ {error}
              </p>
            </div>
          )}

          {/* 最终文本 */}
          {finalText && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                识别结果：
              </h3>
              <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <p className="text-gray-900 dark:text-gray-100 chinese-content leading-relaxed">
                  {finalText}
                </p>
              </div>
            </div>
          )}

          {/* 临时文本 */}
          {interimText && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                临时识别：
              </h3>
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-gray-900 dark:text-gray-100 chinese-content leading-relaxed italic">
                  {interimText}
                </p>
              </div>
            </div>
          )}

          {/* 空状态 */}
          {!finalText && !interimText && !error && (
            <div className="text-center py-12">
              <Mic className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400 chinese-content">
                点击下方按钮开始流式语音识别
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                识别结果将实时显示在这里
              </p>
            </div>
          )}
        </div>

        {/* 控制按钮 */}
        <div className="p-6 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-center space-x-4">
            <button
              onClick={handleToggleListening}
              disabled={isProcessing}
              className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-medium transition-all transform hover:scale-105 ${
                isListening
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              } disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none`}
            >
              {isListening ? (
                <>
                  <MicOff className="w-5 h-5" />
                  <span>停止识别</span>
                </>
              ) : (
                <>
                  <Mic className="w-5 h-5" />
                  <span>开始识别</span>
                </>
              )}
            </button>

            {finalText && (
              <button
                onClick={() => {
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(finalText);
                    // 可以添加toast提示
                  }
                }}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
              >
                复制文本
              </button>
            )}
          </div>

          {/* 使用提示 */}
          <div className="mt-4 text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              💡 提示：系统会自动检测语音活动，5秒静音后自动停止识别
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StreamingRecognition;