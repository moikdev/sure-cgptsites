import {z} from 'zod';
import {validDate} from './finance.ts';
export const marketPricingCommand=z.object({action:z.literal('investmentPricing'),enabled:z.boolean(),mode:z.enum(['preview','commit']).default('preview'),asOf:z.string().refine(validDate).optional(),offset:z.number().int().min(0).max(500).default(0),expectedRevision:z.number().int().safe().nonnegative().optional(),receipt:z.string().length(64).optional()});
