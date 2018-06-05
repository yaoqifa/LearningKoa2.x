
'use strict';

/**
 * Module dependencies.
 */

const contentDisposition = require('content-disposition');
const ensureErrorHandler = require('error-inject');
const getType = require('mime-types').contentType;
const onFinish = require('on-finished');
const isJSON = require('koa-is-json');
const escape = require('escape-html');
const typeis = require('type-is').is;
const statuses = require('statuses');
const destroy = require('destroy');
const assert = require('assert');
const extname = require('path').extname;
const vary = require('vary');
const only = require('only');

/**
 * Prototype.
 */

module.exports = {

  /**
   * Return the request socket.
   *
   * @return {Connection}
   * @api public
   */

  get socket() {
    return this.ctx.req.socket;
  },

  /**
   * Return response header. 响应标头对象。
   *
   * @return {Object}
   * @api public
   */

  get header() {
    const { res } = this;
    return typeof res.getHeaders === 'function'
      ? res.getHeaders()
      : res._headers || {};  // Node < 7.7
  },

  /**
   * Return response header, alias as response.header
   *
   * @return {Object}
   * @api public
   */

  get headers() {
    return this.header;
  },

  /**
   * Get response status code. 获取响应状态。默认情况下，response.status 设置为 404 而不是像 node 的 res.statusCode 那样默认为 200。
   *
   * @return {Number}
   * @api public
   */

  get status() {
    return this.res.statusCode;
  },

  /**
   * Set response status code.
   * 
   * 通过数字代码设置响应状态：
      100 "continue"
      101 "switching protocols"
      102 "processing"
      200 "ok"
      201 "created"
      202 "accepted"
      203 "non-authoritative information"
      204 "no content"
      205 "reset content"
      206 "partial content"
      207 "multi-status"
      208 "already reported"
      226 "im used"
      300 "multiple choices"
      301 "moved permanently"
      302 "found"
      303 "see other"
      304 "not modified"
      305 "use proxy"
      307 "temporary redirect"
      308 "permanent redirect"
      400 "bad request"
      401 "unauthorized"
      402 "payment required"
      403 "forbidden"
      404 "not found"
      405 "method not allowed"
      406 "not acceptable"
      407 "proxy authentication required"
      408 "request timeout"
      409 "conflict"
      410 "gone"
      411 "length required"
      412 "precondition failed"
      413 "payload too large"
      414 "uri too long"
      415 "unsupported media type"
      416 "range not satisfiable"
      417 "expectation failed"
      418 "I'm a teapot"
      422 "unprocessable entity"
      423 "locked"
      424 "failed dependency"
      426 "upgrade required"
      428 "precondition required"
      429 "too many requests"
      431 "request header fields too large"
      500 "internal server error"
      501 "not implemented"
      502 "bad gateway"
      503 "service unavailable"
      504 "gateway timeout"
      505 "http version not supported"
      506 "variant also negotiates"
      507 "insufficient storage"
      508 "loop detected"
      510 "not extended"
      511 "network authentication required"
      注意: 不用太在意记住这些字符串, 如果你写错了,可以查阅这个列表随时更正.
   *
   * @param {Number} code
   * @api public
   */

  set status(code) {
    if (this.headerSent) return;

    assert('number' == typeof code, 'status code must be a number');
    assert(statuses[code], `invalid status code: ${code}`);
    this._explicitStatus = true;
    this.res.statusCode = code;
    if (this.req.httpVersionMajor < 2) this.res.statusMessage = statuses[code];
    if (this.body && statuses.empty[code]) this.body = null;
  },

  /**
   * Get response status message 获取响应的状态消息. 默认情况下, response.message 与 response.status 关联.
   *
   * @return {String}
   * @api public
   */

  get message() {
    return this.res.statusMessage || statuses[this.status];
  },

  /**
   * Set response status message 将响应的状态消息设置为给定值。
   *
   * @param {String} msg
   * @api public
   */

  set message(msg) { // 状态信息
    this.res.statusMessage = msg;
  },

  /**
   * Get response body. 获取响应主体。
   *
   * @return {Mixed}
   * @api public
   */

  get body() {
    return this._body;
  },

  /**
   * Set response body.
   * 将响应体设置为以下之一：
      string 写入
      Buffer 写入
      Stream 管道
      Object || Array JSON-字符串化
      null 无内容响应
      如果 response.status 未被设置, Koa 将会自动设置状态为 200 或 204。
   *
   * @param {String|Buffer|Object|Stream} val
   * @api public
   */

  set body(val) { // 设置响应的主体内容
    const original = this._body;
    this._body = val;

    // no content 204无内容处理
    if (null == val) {
      if (!statuses.empty[this.status]) this.status = 204;
      this.remove('Content-Type');
      this.remove('Content-Length');
      this.remove('Transfer-Encoding');
      return;
    }

    // set the status
    if (!this._explicitStatus) this.status = 200;

    // set the content-type only if not yet set
    const setType = !this.header['content-type'];

    // string Content-Type 默认为 text/html 或 text/plain, 同时默认字符集是 utf-8。Content-Length 字段也是如此。
    if ('string' == typeof val) {
      if (setType) this.type = /^\s*</.test(val) ? 'html' : 'text';
      this.length = Buffer.byteLength(val);
      return;
    }

    // buffer Content-Type 默认为 application/octet-stream, 并且 Content-Length 字段也是如此。
    if (Buffer.isBuffer(val)) {
      if (setType) this.type = 'bin';
      this.length = val.length;
      return;
    }

    // stream Content-Type 默认为 application/octet-stream。
    // 每当流被设置为响应主体时，.onerror 作为侦听器自动添加到 error 事件中以捕获任何错误。
    // 此外，每当请求关闭（甚至过早）时，流都将被销毁。如果你不想要这两个功能，请勿直接将流设为主体。
    // 例如，当将主体设置为代理中的 HTTP 流时，你可能不想要这样做，因为它会破坏底层连接。
    if ('function' == typeof val.pipe) {
      onFinish(this.res, destroy.bind(null, val));
      ensureErrorHandler(val, err => this.ctx.onerror(err));

      // overwriting
      if (null != original && original != val) this.remove('Content-Length');

      if (setType) this.type = 'bin';
      return;
    }

    // json
    this.remove('Content-Length');
    this.type = 'json';
  },

  /**
   * Set Content-Length field to `n`.
   *
   * @param {Number} n
   * @api public
   */

  set length(n) {
    this.set('Content-Length', n);
  },

  /**
   * Return parsed response Content-Length when present.
   *
   * @return {Number}
   * @api public
   */

  get length() {
    const len = this.header['content-length'];
    const body = this.body;

    if (null == len) {
      if (!body) return;
      if ('string' == typeof body) return Buffer.byteLength(body);
      if (Buffer.isBuffer(body)) return body.length;
      if (isJSON(body)) return Buffer.byteLength(JSON.stringify(body));
      return;
    }

    return ~~len;
  },

  /**
   * Check if a header has been written to the socket. 检查是否已经发送了一个响应头。 用于查看客户端是否可能会收到错误通知。
   *
   * @return {Boolean}
   * @api public
   */
  // 判断是否已经开始写入套接字
  get headerSent() {
    return this.res.headersSent;
  },

  /**
   * Vary on `field`.
   *
   * @param {String} field
   * @api public
   */

  vary(field) {
    if (this.headerSent) return;

    vary(this.res, field);
  },

  /**
   * Perform a 302 redirect to `url`. 执行 [302] 重定向到 url.
   * 
   * 字符串 “back” 是特别提供Referrer支持的，当Referrer不存在时，使用 alt 或“/”。
   * 
   * The string "back" is special-cased
   * to provide Referrer support, when Referrer
   * is not present `alt` or "/" is used.
   *
   * Examples:
   *
   *    this.redirect('back');
   *    this.redirect('back', '/index.html');
   *    this.redirect('/login');
   *    this.redirect('http://google.com');
   *
   * 要更改 “302” 的默认状态，只需在该调用之前或之后分配状态。要变更主体请在此调用之后:
        ctx.status = 301;
        ctx.redirect('/cart');
        ctx.body = 'Redirecting to shopping cart';
   * 
   * @param {String} url
   * @param {String} [alt]
   * @api public
   */

  redirect(url, alt) {
    // location
    if ('back' == url) url = this.ctx.get('Referrer') || alt || '/';
    this.set('Location', url);

    // status
    if (!statuses.redirect[this.status]) this.status = 302;

    // html
    if (this.ctx.accepts('html')) {
      url = escape(url);
      this.type = 'text/html; charset=utf-8';
      this.body = `Redirecting to <a href="${url}">${url}</a>.`;
      return;
    }

    // text
    this.type = 'text/plain; charset=utf-8';
    this.body = `Redirecting to ${url}.`;
  },

  /**
   * Set Content-Disposition header to "attachment" with optional `filename`.
   * 
   *  将 Content-Disposition 设置为 “附件” 以指示客户端提示下载。(可选)指定下载的 filename。
   * 
   * @param {String} filename
   * @api public
   */

  attachment(filename) {
    if (filename) this.type = extname(filename);
    this.set('Content-Disposition', contentDisposition(filename));
  },

  /**
   * Set Content-Type response header with `type` through `mime.lookup()`
   * when it does not contain a charset.
   *
   * Examples:
   *
   *     this.type = '.html';
   *     this.type = 'html';
   *     this.type = 'json';
   *     this.type = 'application/json';
   *     this.type = 'png';
   *
   * @param {String} type
   * @api public
   */

  set type(type) {
    type = getType(type);
    if (type) {
      this.set('Content-Type', type);
    } else {
      this.remove('Content-Type');
    }
  },

  /**
   * Set the Last-Modified date using a string or a Date.
   *
   *     this.response.lastModified = new Date();
   *     this.response.lastModified = '2013-09-13';
   *
   * @param {String|Date} type
   * @api public
   */
  //  修改文件上次更新时间，通常用来通知客户端内容需要更新了，不要使用以前的缓存了

  // 将 Last-Modified 标头设置为适当的 UTC 字符串。您可以将其设置为 Date 或日期字符串。
  set lastModified(val) {
    if ('string' == typeof val) val = new Date(val);
    this.set('Last-Modified', val.toUTCString());
  },

  /**
   * Get the Last-Modified date in Date form, if it exists.
   * 将 Last-Modified 标头返回为 Date, 如果存在。
   * @return {Date}
   * @api public
   */

  get lastModified() {
    const date = this.get('last-modified');
    if (date) return new Date(date);
  },

  /**
   * Set the ETag of a response. 设置包含 " 包裹的 ETag 响应， 请注意，没有相应的 response.etag getter。
   * This will normalize the quotes if necessary.
   *
   *     this.response.etag = 'md5hashsum';
   *     this.response.etag = '"md5hashsum"';
   *     this.response.etag = 'W/"123456789"';
   *
   * @param {String} etag
   * @api public
   */
  // 由服务器生成实体tag，用来标识url对象是否发生了更新或改变，当lastModified没办法解决特定问题时候用， 比如：有些文件需要周期性修改，但是内容没有发生变化，这个时候希望
  // 客户端能辨别文件修改了且发起新的请求，不应该使用之前的缓存
  set etag(val) {
    if (!/^(W\/)?"/.test(val)) val = `"${val}"`;
    this.set('ETag', val);
  },

  /**
   * Get the ETag of a response.
   *
   * @return {String}
   * @api public
   */

  get etag() {
    return this.get('ETag');
  },

  /**
   * Return the response mime type void of
   * parameters such as "charset". 获取响应 Content-Type 不含参数 "charset"。
   *  const ct = ctx.type;
      // => "image/png"
   * 
   * @return {String}
   * @api public
   */

  get type() {
    const type = this.get('Content-Type');
    if (!type) return '';
    return type.split(';')[0];
  },

  /**
   * Check whether the response is one of the listed types.
   * Pretty much the same as `this.request.is()`.
   *  
   * 非常类似 ctx.request.is(). 检查响应类型是否是所提供的类型之一。这对于创建操纵响应的中间件特别有用。
      例如, 这是一个中间件，可以削减除流之外的所有HTML响应。
      const minify = require('html-minifier');
      app.use(async (ctx, next) => {
        await next();
        if (!ctx.response.is('html')) return;
        let body = ctx.body;
        if (!body || body.pipe) return;
        if (Buffer.isBuffer(body)) body = body.toString();
        ctx.body = minify(body);
      });
   * @param {String|Array} types...
   * @return {String|false}
   * @api public
   */

  is(types) {
    const type = this.type;
    if (!types) return type || false;
    if (!Array.isArray(types)) types = [].slice.call(arguments);
    return typeis(type, types);
  },

  /**
   * Return response header.
   *
   * Examples:
   *
   *     this.get('Content-Type');
   *     // => "text/plain"
   *
   *     this.get('content-type');
   *     // => "text/plain"
   *
   * @param {String} field
   * @return {String}
   * @api public
   */
// 拿到某项的具体内容  不区分大小写获取响应标头字段值 field。
  get(field) {
    return this.header[field.toLowerCase()] || '';
  },

  /**
   * Set header `field` to `val`, or pass
   * an object of header fields.
   *
   * Examples:
   *
   *    this.set('Foo', ['bar', 'baz']);
   *    this.set('Accept', 'application/json');
   *    this.set({ Accept: 'text/plain', 'X-API-Key': 'tobi' });
   *
   * @param {String|Object|Array} field
   * @param {String} val
   * @api public
   */
  // 传入数组或配置对象 设置响应标头 field 到 value:
  set(field, val) {
    if (this.headerSent) return;

    if (2 == arguments.length) {
      if (Array.isArray(val)) val = val.map(String);
      else val = String(val);
      this.res.setHeader(field, val);
    } else {
      for (const key in field) {
        this.set(key, field[key]);
      }
    }
  },

  /**
   * Append additional header `field` with value `val`.
   *
   * Examples:
   *
   * ```
   * this.append('Link', ['<http://localhost/>', '<http://localhost:3000/>']);
   * this.append('Set-Cookie', 'foo=bar; Path=/; HttpOnly');
   * this.append('Warning', '199 Miscellaneous warning');
   * ```
   *
   * @param {String} field
   * @param {String|Array} val
   * @api public
   */
  // 插入自定义的header配置项  用值 val 附加额外的标头 field。
  append(field, val) {
    const prev = this.get(field);

    if (prev) {
      val = Array.isArray(prev)
        ? prev.concat(val)
        : [prev].concat(val);
    }

    return this.set(field, val);
  },

  /**
   * Remove header `field`.
   *
   * @param {String} name
   * @api public
   */

  remove(field) {
    if (this.headerSent) return;

    this.res.removeHeader(field);
  },

  /**
   * Checks if the request is writable.
   * Tests for the existence of the socket
   * as node sometimes does not set it.
   *
   * @return {Boolean}
   * @api private
   */
  // 判断是否还可以继续写入，，开发时经常会有这样的错误
  get writable() {
    // can't write any more after response finished
    if (this.res.finished) return false;

    const socket = this.res.socket;
    // There are already pending outgoing res, but still writable
    // https://github.com/nodejs/node/blob/v4.4.7/lib/_http_server.js#L486
    if (!socket) return true;
    return socket.writable;
  },

  /**
   * Inspect implementation.
   *
   * @return {Object}
   * @api public
   */

  inspect() {
    if (!this.res) return;
    const o = this.toJSON();
    o.body = this.body;
    return o;
  },

  /**
   * Return JSON representation.
   *
   * @return {Object}
   * @api public
   */

  toJSON() {
    return only(this, [
      'status',
      'message',
      'header'
    ]);
  },

  /**
   * Flush any set headers, and begin the body
   */
  flushHeaders() {
    this.res.flushHeaders();
  }
};
