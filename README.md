# Voice Chat — JSON Edition

نسخه بازسازی‌شده پروژه بدون MySQL.

## نصب

```bash
npm install
```

## اجرا

```bash
npm start
```

سایت:

```text
http://localhost:3002
```

## ذخیره اطلاعات

پیام‌ها داخل این فایل ذخیره می‌شوند:

```text
data/messages.json
```

نیازی به MySQL، phpMyAdmin یا نصب دیتابیس روی سرور نیست.

فایل `messages.json` در اولین اجرای برنامه به صورت خودکار ساخته می‌شود.

## ساختار

```text
project/
├── server.js
├── package.json
├── README.md
├── data/
│   └── messages.json
└── views/
    ├── index.ejs
    └── room.ejs
```

## WebRTC

ویس، وبکم و Screen Share همچنان با WebRTC کار می‌کنند.
ذخیره پیام‌ها فقط از MySQL به JSON منتقل شده است.

اگر TURN قبلی پروژه هنوز فعال باشد، تنظیمات TURN داخل `room.ejs` همان تنظیمات بازیابی‌شده را استفاده می‌کند.
"# Kabare" 
