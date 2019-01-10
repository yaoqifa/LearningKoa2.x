
### Koa2.x 源码阅读顺序

建议先看koa目录下的Readme, 了解koa的基本用法。然后花几分钟时间通读下History.md，对koa的历史有个基本了解。

下面进入正题。

入口是 koa/lib 下的application.js这个文件。这个文件里我做了详细的注释。先看module.export，导出的就是一个Class Application,
Application继承了Emitter, 使用时就是new 它，得到一个koa实例，它能做到的事： 传入中间件，监听端口生成一个服务器实例，然后能拿到http请求，请求逐层的经过middleware数组，经过后的结果
交给handleRespose处理响应，response 里就是具体返回内容。
阅读Application的过程就是：找到module.export, 看到constructor，进入listen方法，发现

```
const server = http.createServer(this.callback());
```
这行代码相当于
```
http.createServer(function (req, res) {
  res.send()
})
```
所以跟进callback方法查看做了什么，

```
 callback() {
    const fn = compose(this.middleware);

    if (!this.listeners('error').length) this.on('error', this.onerror);

    const handleRequest = (req, res) => {
      const ctx = this.createContext(req, res);
      return this.handleRequest(ctx, fn);
    };

    return handleRequest;
  }
```
首先应用了compose方法,该方法的作用就是执行中间件的函数数组里每一项都是函数，递归执行每个函数，前一个函数的结果作为后一个函数的输出。
compose代码很巧妙，一个尾递归，将所有中间件串起来，具体可查看koa-compose。
继续... 上面的错误处理代码可以不看，重点是handleRequest方法,正是callback返回的东西，所以该方法相当于http.createServer里那个回调，handleRequest 里根据createContext方法创建一个ctx，ctx就是执行上下文，通过它能设置和修改req、res、cookies等。下面分析createContext方法的源码。
```
createContext(req, res) {
  const context = Object.create(this.context);
  const request = context.request = Object.create(this.request);
  const response = context.response = Object.create(this.response);
  context.app = request.app = response.app = this;
  context.req = request.req = response.req = req;
  context.res = request.res = response.res = res;
  request.ctx = response.ctx = context;
  request.response = response;
  response.request = request;
  context.originalUrl = request.originalUrl = req.url;
  context.cookies = new Cookies(req, res, {
    keys: this.keys,
    secure: request.secure
  });
  request.ip = request.ips[0] || req.socket.remoteAddress || '';
  context.accept = request.accept = accepts(req);
  context.state = {};
  return context;
}
```
此方法输入是req、res，输出是context，context是在 Object.create(this.context) 的基础上封装(托管)了一些属性,Object.create方法的作用就是利用传进来的对象作为原型创建新的对象，然后将app、request、response、cookies等挂到context上。

在callback回调里的handleRequest方法，再根据createContext生成的ctx和 compose 生成的fn传入 this.handleRequest，下面看this.handleRequest的源码。
```
  handleRequest(ctx, fnMiddleware) {
    const res = ctx.res;
    res.statusCode = 404;
    const onerror = err => ctx.onerror(err);
    const handleResponse = () => respond(ctx);
    onFinished(res, onerror);
    return fnMiddleware(ctx).then(handleResponse).catch(onerror);
  }
```
this.handleRequest 方法就是执行了fnMiddleware,fnMiddleware其实是经过compose处理后的async函数，也就是app.use里传入的async函数。上面的最后跟进入respond方法
```
function respond(ctx) {
  // allow bypassing koa
  if (false === ctx.respond) return;

  const res = ctx.res;
  if (!ctx.writable) return;

  let body = ctx.body;
  const code = ctx.status;

  // 判断状态码是否在合法的状态码范围之内，不是则直接返回
  // ignore body
  if (statuses.empty[code]) {
    // strip headers
    ctx.body = null;
    return res.end();
  }

  if ('HEAD' == ctx.method) {
    if (!res.headersSent && isJSON(body)) {
      ctx.length = Buffer.byteLength(JSON.stringify(body));
    }
    return res.end();
  }

  // 如果body是空，中间件没执行await next()串起来，则设置body为 'not found' || 404 ，ctx.type 设为text
  // status body
  if (null == body) {
    body = ctx.message || String(code); // ctx.status 404 ,ctx.message 'not found'
    if (!res.headersSent) {
      ctx.type = 'text';
      ctx.length = Buffer.byteLength(body);
    }
    return res.end(body);
  }

  // responses
  if (Buffer.isBuffer(body)) return res.end(body);
  if ('string' == typeof body) return res.end(body);
  if (body instanceof Stream) return body.pipe(res);

  // body: json
  body = JSON.stringify(body);
  if (!res.headersSent) {
    // 计算字节长度 用byteLength
    ctx.length = Buffer.byteLength(body);
  }
  res.end(body);
}
```
判断不同条件，最后res.end(body)写入内容。


### Koa2.x 源码阅读 context

  打开koa/lib/context.js 文件，看到 module.exports 一个proto, 这个对象里其实没做什么事，重点是160行的代码，利用require的delegate方法，把response和request挂载到proto上，并分别定义了一些基本方法和属性.
  ```
  delegate(proto, 'response')
  .method('attachment')
  .method('redirect')
  .method('remove')
  .method('vary')
  .method('set')
  .method('append')
  .method('flushHeaders')
  .access('status')
  .access('message')
  ...

/**
 * Request delegation.
 */

delegate(proto, 'request')
  .method('acceptsLanguages')
  .method('acceptsEncodings')
  .method('acceptsCharsets')
  .method('accepts')
  .method('get')
  .method('is')
  .access('querystring')
  .access('idempotent')
  .access('socket')
  .access('search')
  ...

  ```
  感兴趣可以跟进delegate里看源码...


### Koa2.x 源码阅读 request 和 response
  打开koa/lib/request.js 文件,发现module.export 导出一个对象，这个对象包含一系列get set方法，其实就是koa封装的一些api，通读完这些api，就能做基本的开发了。
  打开koa/lib/response.js 文件也一样。具体api的作用，我都做了中文注释。

### koa 的设计很简洁,重点是提供中间件的功能。
  要分析中间件的执行，不得不阅读下 koa-compose 的源码。打开koa-compose文件夹。 先读一下Readme, 作用就是Compose the given middleware and return middleware.。意思是koa里传入一系列的middlewares,compose 将这些middlewares逐一执行。常用的koa服务器可能是这么写的：

  ```
const koa = require('koa')

const app = new koa()

// 中间件类似于栈，先进后出，use有顺序，但并不是只能线性执行，next只是把控制权交给下个中间件

const mid1 = async (ctx, next) => {
  ctx.body = '1'
  await next()
  ctx.body += '4'
}

const mid2 = async (ctx, next) => {
  ctx.type = 'text/json; charset=utf-8'
  ctx.body += '2'
  await next()
  ctx.body += '5'
}

const mid3 = async (ctx, next) => {
  ctx.body += '3'
  // await next()
  ctx.body += '6'
}

app.use(mid1)
app.use(mid2)
app.use(mid3)

app.listen(2333, () => console.log('listening on 2333'))
```
这三个async mid依次通过 app.use调用。 浏览器上打开localhost:2333，显示的内容应该是 123654。好了，下面分析compose源码。

### Koa2.x 源码阅读 koa-compose

打开koa-compose/index.js 文件，该文件module.exports 一个函数 compose, 忽略错误处理的代码，该compose函数返回一个匿名函数，接收两个参数，context和next, 匿名函数里又递归调用dispath方法, 这是一种尾递归，效率很高。源码如下：
```
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
```
从dispatch(0)开始， i=== middleware.length 结束。重点就try里的那行代码，返回了一个Promise，执行fn(context, dispatch.bind(null, i + 1), fn就是middleware数组里的每一项，每项都是一个async函数，也就是上上面里koa服务器代码的mid123,这里把context传给mid1 的ctx，dispatch.bind(null, i + 1) 传给next, dispatch.bind(null, i + 1) 执行了，就返回mid2(context, dispatch.bind(null, i + 1))) 这样...直到完成。
分析下koa服务器的代码执行过程，这种尾递归在内存里是种调用栈的形式，所以在mid1里执行到await next() 就暂停，控制权交给下一个fn，也就是mid2,此时body写入了1，mid2里执行到await next() 再交给mid3.此时body写入了2,执行mid3，body写入了3,写入了6，结束了吗？并没有，这相当于入完栈,然后到出栈过程，控制权回到mid2的await next()后面，body 写入5，mid2出栈，控制权回到mid1的await next()后面，body 写入4。 所以最终body里写入了 123654...

### koa2.x 源码分析告一段落，如有遗漏，可以联系我补充..
### 常用koa中间件
1. koa-static 下面的代码，完成了一个静态服务器的搭建，static 目录下的文件，就能支持通过路径访问
```
const static_ = require('koa-static')
app.use(static_(
    path.join(__dirname, './static')
))
```

2. koa-router 新建一个目录 urls 存放我们的控制器，然后这些控制器通过 app.js 的 koa-router 模块加载
```
// 路由模块使用前需要先安装和实例化
const Router = require('koa-router')
const router = new Router()
// 首页
app.use(async (ctx, next) => {
    if (ctx.request.path === '/') {
      ctx.response.status = 200
      ctx.response.body = 'index'
    }
    await next()
})

// 其他页面通过 router 加载
let urls = fs.readdirSync(__dirname + '/urls')
urls.forEach((element) => {
    let module = require(__dirname + '/urls/' + element)
    /*
      urls 下面的每个文件负责一个特定的功能，分开管理
      通过 fs.readdirSync 读取 urls 目录下的所有文件名，挂载到 router 上面
    */
    router.use('/' + element.replace('.js', ''), module.routes(), module.allowedMethods())
})
app.use(router.routes())
```
3. koa-bodyparser 这是一个解析 POST 数据的模块，解决了 Koa 原生 ctx 访问 POST 数据不太便利的问题
```
const bodyParser = require('koa-bodyparser')
app.use(bodyParser())
app.use(async (ctx, next) => {
 // 载入使用，post 的数据被挂载到 ctx.request.body，是一个 key => value 的 集合
  await next()
})
```
4. koa-views 一个视图管理模块，它的灵活度很高
```
const views = require('koa-views')
const path = require('path')
// 配置视图
app.use(views(path.join(__dirname, './views'), {
    extension: 'ejs'
}))
app.use(async (ctx, next) => {
  await ctx.render('index', {message: 'index'}) // render 渲染方法，这里加载到 views/index.ejs 文件 | 第二参数是传参到模版
  await next()
})
```

5. koa 封装个连接mysql方法
```
// utils/mysql.js
const mysql = require('mysql')
let pools = {}
let query = (sql,callback, host = '127.0.0.1') => {
    if (!pools.hasOwnProperty(host)) {
        pools[host] = mysql.createPool({
            host: host,
            port: '3306',
            user: 'root',
            password: ''

        })
    }
    pools[host].getConnection((err, connection) => {
        connection.query(sql, (err, results) => {
            callback(err, results)
            connection.release()
        })
    })
}
module.exports = query
```
```
/*
 通过一个中间件，把所有的工具关联起来
*/
app.use(async (ctx, next) => {
  ctx.util = {
    mysql: require('./utils/mysql')
  }
    await next()
})

// 操作数据库
app.use(async (ctx, next) => {
  ctx.util.mysql('select * from dbname.dbtable', function(err, results) {
    console.log(results)
  })
  await next()
})
```
