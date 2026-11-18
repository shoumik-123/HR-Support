import { BadRequestException, PipeTransform } from "@nestjs/common";
import { z } from "zod";

/** Validates and strips a request body/query with a zod schema. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return result.data;
  }
}

export const zPagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export function paginate(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export const zId = z.string().min(1).max(64);

/** Trimmed, de-duplicated, case-insensitive list of short strings (skills, tags). */
export const zStringList = (max = 100) =>
  z
    .array(z.string().trim().min(1).max(80))
    .max(max)
    .transform((list) => {
      const seen = new Set<string>();
      return list.filter((s) => {
        const key = s.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
