const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        pass: process.env.MAILER_PASSWORD,
        user: process.env.MAILER_ADDRESS,
    }
});

function sendPoyoringJoinRequestEmail(email, name, url, msg) {
    const message = `PoywebRing Join request from ${name} (${email}):\nURL: https://${url}\n\nMessage:\n${msg || "No message attached."}`
    console.log(message);
    const mailConfiguration = {
        from: process.env.MAILER_ALIAS,
        to: 'tori@poyoweb.org',
        subject: 'PoyowebRing Join Request',
        text: message
    };

    transporter.sendMail(mailConfiguration, function (error) {
        if(error) throw Error(error);
        console.log('Email Sent Successfully');
    });
}

function sendVerificationEmail(token, email) {

    const mailConfigurations = {

        // It should be a string of sender/server email
        from: process.env.MAILER_ALIAS,

        to: email,

        // Subject of Email
        subject: 'PoyoWeb - Email Verification',

        // This would be the text of email body
        text: `Haii! :3\nYou have recently registered on the PoyoWeb!\nPlease follow the given link to verify your email, and start building a better web. :D \n${process.env.URL_ENTIRE}auth/verify/${token}\n Thanks!\n--The PoyoWeb Team`
    };

    transporter.sendMail(mailConfigurations, function (error) {
        if (error) throw Error(error);
        console.log('Email Sent Successfully');
    });
}

function sendRecoveryEmail(token, email) {

    const mailConfigurations = {

        // It should be a string of sender/server email
        from: process.env.MAILER_ALIAS,
        to: email,
        subject: 'PoyoWeb - Password Recovery',
        text: `Haii! :3\nYou have recently requested a password recovery on the PoyoWeb!\nPlease follow the given link to recover your password. :D \n${process.env.URL_ENTIRE}auth/recover/${token}\n Thanks!\n--The PoyoWeb Team\nPD: The link will expire in 24h hehehe.`
    };

    transporter.sendMail(mailConfigurations, function (error) {
        if (error) throw Error(error);
        return console.log('Email Sent Successfully');
    });
}
module.exports = {
    sendPoyoringJoinRequestEmail,
    sendVerificationEmail,
    sendRecoveryEmail
};
