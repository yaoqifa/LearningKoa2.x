'use strict'

/**
 * Expose compositor.
 */

module.exports = compose

/**
 * Compose `middleware` returning
 * a fully valid middleware comprised
 * of all those which are passed.
 *
 * @param {Array} middleware
 * @return {Function}
 * @api public
 */

// middleware是一个数组，数组里的每一项都是function

function compose (middleware) {
  if (!Array.isArray(middleware)) throw new TypeError('Middleware stack must be an， array!')
  for (const fn of middleware) {
    if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!')
  }

  /**
   * @param {Object} context
   * @return {Promise}
   * @api public
   */
  // 递归执行
  return function (context, next) { // 返回匿名函数，接收两个参数，context 和next 
    // last called middleware #
    let index = -1
    return dispatch(0)
    function dispatch (i) { // 一种尾递归
      if (i <= index) return Promise.reject(new Error('next() called multiple times'))
      index = i
      let fn = middleware[i]
      if (i === middleware.length) fn = next
      if (!fn) return Promise.resolve()
      try {
        return Promise.resolve(fn(context, dispatch.bind(null, i + 1))); // 返回promise
      } catch (err) {
        return Promise.reject(err)
      }
    }
  }
}
