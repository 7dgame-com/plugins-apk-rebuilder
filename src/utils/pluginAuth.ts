/**
 * Plugin Auth API 客户端
 *
 * 封装对主后端 Plugin Auth API 的调用。
 */

import axios, { AxiosError } from 'axios';
import { MAIN_API_URL, PLUGIN_NAME } from '../config';

// 默认重试配置
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RETRY_DELAY = 500; // 毫秒

/**
 * 带重试的请求封装
 */
async function withRetry<T>(requestFn: () => Promise<T>, retries: number = DEFAULT_RETRY_COUNT, delay: number = DEFAULT_RETRY_DELAY): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await requestFn();
    } catch (err: any) {
      if (err instanceof AxiosError) {
        const status = err.response?.status;
        if (status && status >= 400 && status < 500) {
          throw err;
        }
      }
      if (attempt === retries) {
        throw err;
      }
      console.warn(`[PluginAuth] 请求失败，${delay}ms 后第 ${attempt + 1} 次重试...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('[PluginAuth] Unexpected: retry loop exited without result');
}

/**
 * 验证 JWT Token 并获取用户信息
 * @param authHeader - Authorization 请求头（Bearer xxx）
 */
export async function verifyToken(authHeader: string): Promise<any> {
  const response = await withRetry(() =>
    axios.get(`${MAIN_API_URL}/v1/plugin/verify-token`, {
      headers: { Authorization: authHeader },
    })
  );

  if (response.data && response.data.code === 0) {
    return response.data.data; // { id, username, nickname, roles }
  }

  throw new Error(response.data?.message || '认证失败');
}
