import { z } from "zod";

/** The parts of a Telegram update Alfred reads. Everything else is ignored. */
const Chat = z.object({ id: z.union([z.number(), z.string()]), type: z.string().optional() });

export const TelegramUpdate = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      message_id: z.number().int(),
      chat: Chat,
      text: z.string().max(4096).optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().max(64).optional(),
      message: z.object({ message_id: z.number().int(), chat: Chat }).optional(),
    })
    .optional(),
});

export type TelegramUpdateData = z.infer<typeof TelegramUpdate>;
