// 数据验证模式

import Joi from 'joi'

// 企业验证模式
export const enterpriseSchemas = {
  create: Joi.object({
    name: Joi.string().required().min(1).max(255),
    description: Joi.string().max(1000),
    logo: Joi.string().uri(),
    website: Joi.string().uri(),
    industry: Joi.string().max(100),
    size: Joi.string().max(50),
  }),
  update: Joi.object({
    name: Joi.string().min(1).max(255),
    description: Joi.string().max(1000),
    logo: Joi.string().uri(),
    website: Joi.string().uri(),
    industry: Joi.string().max(100),
    size: Joi.string().max(50),
    status: Joi.string().valid('active', 'inactive'),
  }),
}

// 用户验证模式
export const userSchemas = {
  create: Joi.object({
    email: Joi.string().email().required(),
    name: Joi.string().required().min(1).max(255),
    role: Joi.string().valid('admin', 'manager', 'user').required(),
    permissions: Joi.array().items(Joi.string()),
  }),
  update: Joi.object({
    name: Joi.string().min(1).max(255),
    role: Joi.string().valid('admin', 'manager', 'user'),
    permissions: Joi.array().items(Joi.string()),
    status: Joi.string().valid('active', 'inactive', 'suspended'),
  }),
}

// 知识库文档验证模式
export const documentSchemas = {
  create: Joi.object({
    title: Joi.string().required().min(1).max(500),
    content: Joi.string().required(),
    contentType: Joi.string().valid('text', 'markdown', 'html'),
    tags: Joi.array().items(Joi.string()),
    permissions: Joi.object({
      read: Joi.array().items(Joi.string()),
      write: Joi.array().items(Joi.string()),
    }),
  }),
  update: Joi.object({
    title: Joi.string().min(1).max(500),
    content: Joi.string(),
    contentType: Joi.string().valid('text', 'markdown', 'html'),
    tags: Joi.array().items(Joi.string()),
    permissions: Joi.object({
      read: Joi.array().items(Joi.string()),
      write: Joi.array().items(Joi.string()),
    }),
    status: Joi.string().valid('draft', 'published', 'archived'),
  }),
  search: Joi.object({
    query: Joi.string().required(),
    tags: Joi.array().items(Joi.string()),
    limit: Joi.number().min(1).max(100),
    offset: Joi.number().min(0),
  }),
}

// Agent 模板验证模式
export const templateSchemas = {
  create: Joi.object({
    name: Joi.string().required().min(1).max(255),
    description: Joi.string().max(1000),
    category: Joi.string().required(),
    config: Joi.object().required(),
    tags: Joi.array().items(Joi.string()),
    permissions: Joi.object({
      read: Joi.array().items(Joi.string()),
      write: Joi.array().items(Joi.string()),
    }),
  }),
  update: Joi.object({
    name: Joi.string().min(1).max(255),
    description: Joi.string().max(1000),
    category: Joi.string(),
    config: Joi.object(),
    tags: Joi.array().items(Joi.string()),
    permissions: Joi.object({
      read: Joi.array().items(Joi.string()),
      write: Joi.array().items(Joi.string()),
    }),
  }),
  publish: Joi.object({
    version: Joi.string().required(),
    changelog: Joi.string(),
  }),
}

// Token 配额验证模式
export const quotaSchemas = {
  set: Joi.object({
    monthlyLimit: Joi.number().required().min(1),
    dailyLimit: Joi.number().required().min(1),
  }),
}

// Token 告警验证模式
export const alertSchemas = {
  set: Joi.object({
    type: Joi.string().valid('usage_threshold', 'quota_exceeded', 'cost_limit').required(),
    threshold: Joi.number().required().min(0),
    notificationChannels: Joi.array().items(Joi.string()).required(),
  }),
}

// 认证验证模式
export const authSchemas = {
  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required().min(6),
    enterpriseId: Joi.string().required(),
  }),
  register: Joi.object({
    email: Joi.string().email().required(),
    name: Joi.string().required().min(1).max(255),
    password: Joi.string().required().min(6),
    enterpriseId: Joi.string().required(),
  }),
}
