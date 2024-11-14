// 从 `astro:content` 导入辅助工具
// import { string } from "astro/zod";
import { z, defineCollection, reference } from "astro:content";
// import { getCollection } from "astro:content";

// 为每一个集合定义一个 `type` 和 `schema`
const blogCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    pubDate: z.date(),
    description: z.string(),
    author: z.string(),
    occupation: z.string(),
    heroImage: z.string(),
    heroImageAlt: z.string(),
    tags: z.array(z.string()),
    lang: z.string(),
    multiLanguage: z.array(reference('blog'))
  })
});

// 导出一个单独的 `collections` 对象来注册你的集合
export const collections = {
  blog: blogCollection,
};

// 获取Blog所有图片
export const blogImages: Record<string, { default: ImageMetadata }> = import.meta.glob("/src/data/blog/*/*.jpg", { eager: true });