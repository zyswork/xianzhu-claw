// 错误处理工具

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string
  ) {
    super(message)
    Object.setPrototypeOf(this, AppError.prototype)
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public details?: any) {
    super(400, message, 'VALIDATION_ERROR')
    Object.setPrototypeOf(this, ValidationError.prototype)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource}不存在`, 'NOT_FOUND')
    Object.setPrototypeOf(this, NotFoundError.prototype)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = '未授权') {
    super(401, message, 'UNAUTHORIZED')
    Object.setPrototypeOf(this, UnauthorizedError.prototype)
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = '禁止访问') {
    super(403, message, 'FORBIDDEN')
    Object.setPrototypeOf(this, ForbiddenError.prototype)
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT')
    Object.setPrototypeOf(this, ConflictError.prototype)
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = '内部服务器错误') {
    super(500, message, 'INTERNAL_SERVER_ERROR')
    Object.setPrototypeOf(this, InternalServerError.prototype)
  }
}

export function isAppError(error: any): error is AppError {
  return error instanceof AppError
}
