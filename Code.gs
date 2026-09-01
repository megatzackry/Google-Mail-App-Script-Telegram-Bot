function setup() {
  const bot_token = 'YOUR_BOT_TOKEN'; // Paste your full bot token from @BotFather, e.g. 123456789:AAExample-Token
  const webapp_url = 'YOUR_WEBAPP_URL'; // Paste your deployed Web app URL (shown after you deploy)

  const [bot_id, api_key] = bot_token.split(':');
  if (!bot_id || !api_key) return console.error('Replace YOUR_BOT_TOKEN with your actual bot API token (from @BotFather).');
  if (webapp_url.includes('YOUR_WEBAPP_URL')) return console.error('Replace YOUR_WEBAPP_URL with your deployed Web app URL.');

  const props = PropertiesService.getScriptProperties();
  props.setProperty('BOT_ID', bot_id);
  props.setProperty(bot_id, api_key);

  console.log(`Stored credentials for bot_id ${bot_id}.`);
  new Telegram().setWebhook(webapp_url, ['message', 'edited_message', 'chat_member', 'callback_query', 'my_chat_member', 'chat_join_request']);
}

function doPost(e) {
  const u = new Update(e);
  try {
    switch (u.type) {
      case 'message':
      case 'edited_message': return handleMessage(u[u.type]);
      case 'chat_member': return handleChatMember(u.chat_member);
      case 'callback_query': return handleCallback(u.callback_query);
      case 'my_chat_member': return handleMyChatMember(u.my_chat_member);
      case 'chat_join_request': return handleJoinRequest(u.chat_join_request);
      default: throw new Errors('Unhandled update', `type: ${u.type}`);
    }
  } catch (error) {
    Errors.handle(error, u.raw || e.postData.contents);
  }
}

function forceReply(uid, ss, bot, text = 'Enter your Email Address.', message_id){
  ss.cache.del(uid);
  return bot.send({
    chat_id: uid, text, reply_parameter: { message_id }, allow_sending_without_reply: true,
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'your@email' },
    entities: [{ offset: text.indexOf('Email Address'), length: 13, type: 'underline' }]
  }, 'sendMessage');
}

function handleJoinRequest(cjr){
  const bot = new Telegram();
  const user = new Sheet().getUserId(cjr.user_chat_id);
  if (user.email) {
    if (cjr.query_id) return bot.answerJoinRequest(cjr.query_id, 'approve', user);
    return bot.approveJoinRequest(cjr.user_chat_id);
  }
  new Sheet().getss('users').getRange(user.row, 4).setValue('requested');
  return bot.sendJoinRequestWebApp(cjr.query_id, 'https://t.me/googleappscriptsbot?start');
}

function handleChatMember(cm){
  const ss = new Sheet();
  const bot = new Telegram();
  const newer = cm.new_chat_member;
  const user = ss.getUserId((newer.user || cm.old_chat_member.user).id);
  if (String(cm.chat.id) === bot.groupId){
    if (user.row) ss.getss('users').getRange(user.row, 4).setValue(newer.status);
    if (user.email) return bot.setMemberTag(user.uid, '✓', newer.status); // send welcome group message
    if (!newer.user.is_bot) return bot.setMemberTag(user.uid, '', newer.status);
  }
}

function handleMyChatMember(mcm){
  const props = PropertiesService.getScriptProperties();
  const status = mcm.new_chat_member.status;
  if (['member', 'administrator'].includes(status)) {
    props.setProperty('GROUP_ID', String(mcm.chat.id));
  } else if (['left', 'kicked'].includes(status) && props.getProperty('GROUP_ID') === String(mcm.chat.id)) {
    props.deleteProperty('GROUP_ID');
  }
}

function handleCallback(cbq){
  if (cbq.data && cbq.data === 'retry') {
    const bot = new Telegram();
    const ss = new Sheet();
    const user = ss.getUserId(cbq.from.id);
    if (user.otp) {
      const remaining = (user.otp.min || 0) - Date.now();
      if (remaining > 0) return bot.answer(cbq.id, `⌛ Please wait ${Math.ceil(remaining / 1000)}s before retrying.`);
    }
    const reply = cbq.message.reply_to_message;
    if (reply?.entities?.[0]?.type === 'email') {
      try { 
        sendOTP(reply, user, ss, new Telegram());
      } catch (e) { 
        Errors.handle(e, cbq);
        return bot.answer(cbq.id, '🔄 Try again tomorrow.');
      }
    } else {
      forceReply(user.uid, ss, bot, 'Please enter your Email Address.', 0);
    }
    bot.send({chat_id: user.uid, message_id: cbq.message.message_id}, 'deleteMessage');
    return bot.answer(cbq.id);
  }
}

function handleMessage(msg){
  const bot = new Telegram();
  const ss = new Sheet();
  if (msg.chat.type === 'supergroup') {
    if (msg.is_automatic_forward) return bot.send({ chat_id: msg.chat.id, message_id: msg.message_id },'unpinChatMessage');
    return;
  } else if (msg.chat.type === 'private') {
    const user = ss.getUserId(msg.chat.id);
    if (msg.text) {
      const txt = msg.text.trim();
      if (/^\/start/.test(txt)) {
        return forceReply(user.uid, ss, bot, 'Please enter your Email Address.', msg.message_id);
      } else if (msg.entities?.[0]?.type === 'email') {
        return sendOTP(msg, user, ss, bot);
      } else if (user.otp) {
        if (user.otp.dgt === txt) {
          Object.assign(user, { email: user.otp.mail, otp: null,});
          ss.cache.set(user.uid, user);
          ss.getss('users').getRange(user.row, 3).setValue(user.email);
          if (user.status === 'requested') bot.approveJoinRequest(user.uid);
          return bot.send({chat_id: user.uid, text: `You are successfully verified as ${user.email}`, 
          reply_markup: { inline_keyboard: [
            [{ text: 'Join Google App Scripts Group', url: 'https://t.me/googleappscripts' }],
            [{ text: 'View this project on GitHub', url: 'https://github.com/megatzackry/Google-Mail-App-Script-Telegram-Bot' }]
          ] } }, 'sendMessage');
        } else if (++user.otp.trl > 2) {
          bot.send({ 
            chat_id: user.uid,
            reply_parameters: { message_id: user.otp.mid },
            text: '🔒 Maximum attempts reached!', reply_markup: { inline_keyboard: [[{ text: '📩 Request new OTP', callback_data: 'retry' }]] }
          });
          throw new Errors('Max OTP attempts', `uid: ${user.uid}, email tried: ${user.otp.mail}`);
        }
        ss.cache.set(user.uid, user);
        return bot.send({ chat_id: user.uid, reply_parameters: { message_id: msg.message_id }, text: 'Incorrect OTP ! Check your email again.' });
      }
    }

    forceReply(user.uid, ss, bot, 'Enter a valid Email Address.', msg.message_id);
    const msgType = ['photo', 'video', 'sticker', 'document', 'audio', 'voice', 'video_note', 'location', 'contact', 'poll'].find(t => msg[t]);
    throw new Errors(`Private ${msgType ?? 'unknown'} message`, JSON.stringify(msg[msgType] ?? ''));
  }
}

function sendOTP(msg, user, ss = new Sheet(), bot = new Telegram()){
  user.otp = {
    mail: msg.text.toLowerCase().trim(),
    mid: msg.message_id,
    min: new Date().getTime() + 120000,
    dgt: Math.floor(100000 + Math.random() * 900000).toString(),
    trl: 0,
  };
  if (user.email === user.otp.mail) return forceReply(user.uid, ss, bot, 'You are already verified with this Email Address', msg.message_id);
  ss.cache.set(user.uid, user, 3);
  try {
    MailApp.sendEmail({
      to: user.otp.mail,
      subject: `Your verification code is ${user.otp.dgt}`,
      body: `Your verification code is ${user.otp.dgt}\n\nEnter this code in the Telegram bot to verify your email.\n\nExpires in 5 minutes.`,
      htmlBody: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="light dark">
      <meta name="supported-color-schemes" content="light dark">
      <title>Verify your email</title>
      <style>@media (prefers-color-scheme:dark){
        .bg{background:#0e1621!important}
        .card{background:#17212b!important;border-color:#242f3d!important}
        .hd{color:#f1f5f9!important}
        .mut{color:#93a4b5!important}
        .ft{color:#7c8a99!important}
        .code{background:#101923!important;border-color:#24313f!important;color:#5eb5f7!important}
      }</style>
      </head>
      <body class="bg" style="margin:0;padding:0;background:#f4f6f8;">
      <table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;">
      <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="320" cellpadding="0" cellspacing="0" style="width:100%;max-width:320px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <tr><td align="center" style="padding-bottom:18px;">
      <span class="ft" style="font-size:12px;font-weight:700;letter-spacing:1.5px;color:#9aa5b1;text-transform:uppercase;">🤖 Google Apps Script Telegram Bot</span>
      </td></tr>
      <tr><td class="card" style="background:#ffffff;border:1px solid #e5e9ed;border-radius:16px;padding:28px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
      <p class="hd" style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">Verify your email</p>
      <p class="mut" style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#586474;">Enter this code back in the Telegram bot to finish verifying your address.</p>
      </td></tr>
      <tr><td align="center" style="padding-bottom:22px;">
      <span class="code" style="display:inline-block;width:100%;box-sizing:border-box;background:#eef6fb;border:1px solid #d7e8f2;border-radius:10px;padding:12px 18px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:26px;font-weight:700;letter-spacing:6px;color:#0088cc;">${user.otp.dgt}</span>
      </td></tr>
      <tr><td align="center" style="padding-bottom:18px;">
      <a href="https://telegram.me/googleappscriptsbot?text=${user.otp.dgt}" role="button" aria-label="Verify in Telegram" style="display:block;width:100%;box-sizing:border-box;background:#0088cc;color:#ffffff;font-size:16px;font-weight:600;padding:15px 20px;border-radius:10px;text-align:center;text-decoration:none;">Verify in Telegram</a>
      </td></tr>
      <tr><td align="center">
      <p class="ft" style="margin:0 0 4px;font-size:13px;color:#9aa5b1;">Expires in 5 minutes. Didn't request this? Just ignore this email.</p>
      </td></tr>
      </table>
      </td></tr>
      <tr><td style="padding:24px 2px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
      <td align="center" width="50%" style="padding:6px 2px;"><a class="mut" href="https://t.me/googleappscripts" style="font-size:14px;color:#586474;text-decoration:none;">👥&nbsp;GAS Group</a></td>
      <td align="center" width="50%" style="padding:6px 2px;"><a class="mut" href="https://t.me/googleappscriptsbot" style="font-size:14px;color:#586474;text-decoration:none;">🤖&nbsp;GAS Bot</a></td>
      </tr><tr>
      <td align="center" width="50%" style="padding:6px 2px;"><a class="mut" href="https://github.com/megatzackry/Google-Mail-App-Script-Telegram-Bot" style="font-size:14px;color:#586474;text-decoration:none;">✉️&nbsp;Gmail Bot</a></td>
      <td align="center" width="50%" style="padding:6px 2px;"><a class="mut" href="https://github.com/megatzackry/Google-App-Script-Telegram-Bot" style="font-size:14px;color:#586474;text-decoration:none;">🚀&nbsp;GAS Template</a></td>
      </tr>
      </table>
      </td></tr>
      <tr><td align="center" style="padding:22px 12px 0;">
      <p class="ft" style="margin:0;font-size:13px;line-height:1.6;color:#9aa5b1;">Automated message from @googleappscriptsbot</p>
      </td></tr>
      </table>
      </td></tr>
      </table>
      </body>
      </html>`,
    });
    return bot.send({
      chat_id: user.uid, reply_parameters: { message_id: msg.message_id, quote_entities: msg.entities[0] },
      text: 'Your One-Time Password was emailed to this address.\n📥 Check your inbox or spam folders.',
      reply_markup: { inline_keyboard: [[{ text: '📩 Resend new OTP', callback_data: 'retry'}]]}
    }, 'sendMessage');
  } catch (e) {
    bot.send({
      chat_id: user.uid, reply_parameters: { message_id: msg.message_id },
      text: '🤯 Too many users are joining us today!\nNot to worry, try again early tomorrow.',
      reply_markup: { inline_keyboard: [[{ text: '📩 Resend new OTP', callback_data: 'retry'}]]}
    }, 'sendMessage');
    throw new Errors('MailApp Failed\n' + JSON.stringify(e.message), `uid: ${user.uid}\nemail: ${user.otp.mail}`);
  }
}

class Update {
  constructor(e) {
    this.raw = JSON.parse(e.postData.contents);
    this.type = Object.keys(this.raw).find((k) => k !== 'update_id');
    this[this.type] = this.raw[this.type];
  }
};


class Telegram {
  constructor(bot_id = PropertiesService.getScriptProperties().getProperty('BOT_ID')) {
    this.start = Date.now();
    if (!bot_id) throw new Errors('No bot configured', 'Run setup() first to store your bot token.');
    this.id = String(bot_id);
    this.token = `${this.id}:${PropertiesService.getScriptProperties().getProperty(this.id)}`;
  }

  get groupId() {
    return PropertiesService.getScriptProperties().getProperty('GROUP_ID');
  }

  setWebhook (url, allowed_updates) {
    console.log(this.send({ drop_pending_updates: false }, 'deleteWebhook'));
    console.log(this.send({ url, allowed_updates }, 'setWebhook'));
  }
  
  sleepCheck (sleeps, error) {
    if ((Date.now() - this.start + sleeps) > 5.5 * 60000) {
      throw new Errors(`Execution limit exceed.\nCanceled sleep for ${sleeps/1000}s`, JSON.stringify(error, null, 1));
    }
    Utilities.sleep(sleeps);
  }

  fetch (url, params, i = 1) {
    try {
      return JSON.parse(UrlFetchApp.fetch(url, params).getContentText());
    } catch (e) {
      if (i > 2) throw new Errors(JSON.stringify(e, null, 1), url);
      this.sleepCheck(5000 * i, e);
      return this.fetch(url, params, i + 1);
    }
  }

  send (pld, end, i = 1) {
    const rsp = this.fetch(`https://api.telegram.org/bot${this.token}/${end}`, { method: 'post', contentType: 'application/json', payload: JSON.stringify(pld), muteHttpExceptions: true }, i);
    if (rsp.ok) {
      return new Sheet().getss('events').appendRow([new Date(), `Successful ${end}`, '', JSON.stringify(pld, null, 1), JSON.stringify(rsp, null, 1)]);
    } else if (rsp.error_code === 429) {
      if (i > 2) return rsp;
      const retryAfter = rsp.parameters?.retry_after || 10;
      this.sleepCheck(retryAfter * 1000, rsp);
      return this.send(pld, end, i + 1);
    } else if (rsp.error_code) {
      new Errors(end, JSON.stringify(rsp, null, 1)).log(pld);
      return rsp;
    } else if (i > 2) {
      throw new Errors(`Max failed retry ${end}`,JSON.stringify(rsp, null, 1)).log(pld);
    }
    this.sleepCheck(5000 * i, rsp);
    return this.send(pld, end, i + 1);
  }

  answer (callback_query_id, text) {
    if (text) return this.send({ callback_query_id, text, show_alert: true }, 'answerCallbackQuery');
    return this.send({ callback_query_id }, 'answerCallbackQuery');
  }

  unbanMember (chat_id, user_id) { return this.send({ chat_id, user_id }, 'unbanChatMember'); }
  getMember (chat_id, user_id) { return this.send({ chat_id, user_id }, 'getChatMember')?.result?.status; }
  setMemberTag (user_id, tag, status = this.getMember(this.groupId, user_id)) {
    if (status === 'member') return this.send( { chat_id: this.groupId, user_id, tag }, 'setChatMemberTag' );
  }

  removeMember (user_id) {
    if (this.getMember(this.groupId, user_id) === 'member') { 
      this.send({ chat_id: this.groupId, user_id, revoke_messages: true }, 'banChatMember');
      this.send({ chat_id: this.groupId, user_id }, 'unbanChatMember');
    }
  }
  
  sendJoinRequestWebApp(chat_join_request_query_id, web_app_url) { return this.send({ chat_join_request_query_id, web_app_url }, 'sendChatJoinRequestWebApp')}
  approveJoinRequest (user_id) { return this.send({ chat_id: this.groupId, user_id }, 'approveChatJoinRequest'); }
  answerJoinRequest (chat_join_request_query_id, result, user){ 
    const rsp = this.send({ chat_join_request_query_id, result }, 'answerChatJoinRequestQuery');
    if (!rsp.ok && result === 'approve') return this.approveJoinRequest(user.uid);
  }

};

class Cache {
  constructor() { this.cache = CacheService.getDocumentCache(); }
  get(key) { return this.cache.get(String(key)); }
  del(key) { return this.cache.remove(String(key)); }
  set(key, val, sec = 216) { return this.cache.put(String(key), JSON.stringify(val), sec * 100); }
};

class User {
  constructor({ row, uid, email, status, otp }) {
    this.row = row;
    this.uid = uid || null;
    this.email = email || null;
    this.status = status || null;
    this.otp = otp || null;
  }
};

class Sheet {
  constructor() {
    this.ss = {};
    this.cache = new Cache();
    this.doc = SpreadsheetApp.getActiveSpreadsheet();
  }

  getCache(key) {
    const v = this.cache.get(key);
    return v == null ? null : JSON.parse(v);
  }

  getNextRow(ss, range, val) {
    return ss.getRange(range).createTextFinder(val).matchCase(false).matchEntireCell(true).findNext()?.getRow();
  }

  getss(sheet) {
    const s = String(sheet);
    if (!this.ss[s]) {
      this.ss[s] = this.doc.getSheetByName(s);
      if (!this.ss[s]) {
        this.ss[s] = this.doc.insertSheet(s);
        const headers = {
          events: ['Date Time', 'Details', 'Updates', 'Payload', 'Response'],
          errors: ['Date Time', 'Message', 'Details', 'Payload'],
          users: ['Date Time', 'User Id', 'Email', 'Status']
        };
        if (headers[s]) this.ss[s].appendRow(headers[s]);
      }
    }
    return this.ss[s];
  }

  getUserId(uid) {
    const cached = this.cache.get(uid);
    if (cached) return new User(JSON.parse(cached));
    const userSheet = this.getss('users');
    const row = this.getNextRow(userSheet, 'B2:B', uid);
    if (!row) {
      userSheet.appendRow([new Date(), uid]);
      SpreadsheetApp.flush();
      return this.getUserId(uid);
    }
    const values = userSheet.getSheetValues(row, 3, 1, 2)[0];
    const user = new User({row, uid, email: values[0], status: values[1]});
    this.cache.set(uid, user);
    return user;
  }

};

class Errors extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
    this.name = this.constructor.name;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
  log(u) {
    let str = '';
    try { str = u ? JSON.stringify(u, null, 1) : ''; } catch (e) { str = '[Circular or Unstringifiable Object]'; }
    new Sheet().getss('errors').appendRow([new Date(), this.message, this.details, str]);
  }

  static handle(error, u) {
    if (error instanceof Errors) return error.log(u);
    new Errors(error.message || 'Unknown Error', error.stack || 'No Stack').log(u);
  }
};
