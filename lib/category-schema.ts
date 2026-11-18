import {z} from 'zod';
export const categoryIconSchema=z.string().trim().min(1).max(80);
