import dotenv from 'dotenv';
import { loadConfig } from './loadConfig.js';

export type { Config, ImageProviderName, MotionProviderName, RedditAccessMode } from './loadConfig.js';

dotenv.config();

export const CONFIG = loadConfig(process.env, process.cwd());
