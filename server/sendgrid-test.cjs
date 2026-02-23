require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Use a verified sender/recipient (set in .env or change here). SendGrid requires verified sender.
const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.RECIPIENT_EMAIL || 'test@example.com';
const toEmail = process.env.RECIPIENT_EMAIL || 'test@example.com';

const msg = {
  to: toEmail,
  from: fromEmail,
  subject: 'Sending with SendGrid is Fun',
  text: 'and easy to do anywhere, even with Node.js',
  html: '<strong>and easy to do anywhere, even with Node.js</strong>',
};

sgMail
  .send(msg)
  .then(() => {
    console.log('Email sent');
  })
  .catch((error) => {
    console.error(error);
  });
