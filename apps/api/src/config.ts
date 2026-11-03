import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3333),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  CAMERA_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'CAMERA_KEY deve ter 64 caracteres hex'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('./uploads'),
  GATEWAY_PUBLIC_URL: z.string().default('http://localhost:1984'),
  CAMERA_TOKEN_TTL_SECONDS: z.coerce.number().default(120),
  GATEWAY_TOKEN: z.string().default(''),
  PSP_PROVIDER: z.string().default('asaas'),
  ASAAS_API_KEY: z.string().default(''),
  ASAAS_BASE_URL: z.string().default('https://sandbox.asaas.com/api/v3'),
  PSP_WEBHOOK_TOKEN: z.string().default(''),
});

export const config = schema.parse(process.env);
