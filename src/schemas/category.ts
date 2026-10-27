import { z } from "zod";

const Name = z.string().trim().min(1).max(40);

export const CreateCategory = z.object({
  name: Name,
  kind: z.enum(["expense", "income"]),
});

export const UpdateCategory = z
  .object({
    name: Name.optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export interface CategoryDto {
  id: string;
  name: string;
  kind: "expense" | "income";
  archived: boolean;
  isSystem: boolean;
}
