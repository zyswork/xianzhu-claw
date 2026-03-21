// 验证中间件

import { Request, Response, NextFunction } from 'express'
import Joi from 'joi'

export function validateRequest(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    })

    if (error) {
      const messages = error.details.map(detail => detail.message)
      res.status(400).json({
        error: '数据验证失败',
        details: messages,
      })
      return
    }

    req.body = value
    next()
  }
}

export function validateQuery(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
    })

    if (error) {
      const messages = error.details.map(detail => detail.message)
      res.status(400).json({
        error: '查询参数验证失败',
        details: messages,
      })
      return
    }

    req.query = value
    next()
  }
}
