const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('./db');
const path = require('path');
const fs = require('fs-extra')
const multer = require('multer');
const bcrypt = require('bcrypt');
const { exec } = require('child_process');
require('dotenv').config();

const verifyFile = require('./snippets/verifyFile');
const dirWalker = require('./snippets/dirWalker');
const { verify } = require('crypto');
const mailer = require('./mailer');

db.setupDB();

const app = express();
const port = 9000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', 'views');

async function verifyApiKey(apiKey) {
    return new Promise((resolve, reject) => {
        jwt.verify(apiKey, process.env.AUTH_SECRET, (err, decoded) => {
            if (err) {
                resolve(false);
            } else {
                db.findUserById(decoded.id).then((user) => {
                    if (user) {
                        resolve(user);
                    } else {
                        resolve(false);
                    }
                })
            }
        });
    });
}

const userBlacklist = ["dns", "social", "faq", "poyoweb", "www","admin","poyo","mrdapoyo", "reporter", "weblink", "oreneta", "neocities", "dapoyo", "bitch", "newrubix", "api", "blog", "official"]
const domainBlacklist = ["poyoweb.me"];

function checkUsername(username) {
    const regex = /^[a-zA-Z0-9]+$/; // Regex to allow only alphanumeric characters (letters and numbers)

    if (username.length > 20) {
        return 'Username must have at max 20 characters';
    } else if (!regex.test(username)) {
        return 'Username must contain only letters and numbers';
    } else if (userBlacklist.includes(username)) {
        return 'Username is blacklisted, try again with a different username';
    } else {
        return true;
    }
}


function checkDomain(inputString) {
  for (const blacklistedUser of domainBlacklist) {
    if (inputString.includes(blacklistedUser)) {
      return false;
    }
  }
  return true;
}

app.post('/auth/register', async (req, res) => {
    var { username, email, password } = req.body;
    username = username.toLowerCase();
    var usernameTest = checkUsername(username);
    if (!usernameTest) {
    	return res.status(400).json({error: usernameTest, success: false});
    }
    if (!username || !email || !password) {
        res.status(400).json({ error: 'Missing required fields', success: false});
        return;
    } 
    if (process.env.CONFIG_MAX_USERS < await db.getUserCount()) {
    	return res.status(400).json({ error: 'Max user capacity reached', success: false})
    } else if (password.length > 7) {
        try {
            const hashedPassword = await db.hashPassword(password);
            const result = await db.createUser(username, email, await hashedPassword);

            if (result.success) {
                fs.mkdir(path.join(__dirname, 'websites/users', username), { recursive: true });
                mailer.sendVerificationEmail(result.jwt, email);
                res.status(201).json({ message: 'User registered successfully', jwt: result.jwt, success: result.success });
            } else {
                res.status(400).json({ error: result.message, success: result.success });
            }
        } catch (error) {
            res.status(500).json({ error: error });
        }
    } else {
        res.status(400).json({ error: 'Password must be at least 8 characters long', success: false });
    }
});

app.post('/auth/login', async (req, res) => {
    const { user, password } = req.body;
    if ((!user) || !password) {
        res.status(400).json({ error: 'Missing required fields', success: false });
        return;
    } else {
        try {
            const result = await db.loginUser(user, password);
            if (result.success) {
                res.status(200).json({ message: 'User logged in successfully', jwt: result.jwt, success: result.success });
            } else {
                res.status(400).json({ error: result.message, success: result.success });
            }
        } catch (error) {
            res.status(500).json({ error: JSON.parse(error) });
        }
    }
});


app.get('/auth/verify', (req, res) => {
    const { token } = req.query;

    // Verifying the JWT token 
    jwt.verify(token, process.env.AUTH_SECRET, function (err, decoded) {
        if (err) {
            console.log(err);
            res.status(401).json({error: "Email verification failed, possibly the link is invalid or expired", success: false});
        }
        else {
            db.db.run('UPDATE users SET verified = 1  WHERE id = ?', [decoded.id], (err) => {
                if (err) {
                    console.error(err.message);
                    res.status(400).json({error: "Email verification failed, possibly the link is invalid or expired", success: false});
                } else {
                    var newToken = jwt.sign(
                        { username: decoded.username, email: decoded.email, verified: 1 },
                        process.env.AUTH_SECRET,
                        { expiresIn: "30d" }
                    );
                    res.status(200).json({ token: newToken, message: "Successfully Verified!", success: true });
                }
            });

        }
    });
});

app.post('/auth/sendRecoveryEmail', async (req, res) => {
    var email = req.body.email;
    if (!email) {
    	return res.status(403).send('User Not Found');
    }
    db.db.get('SELECT * FROM users WHERE email = ?;', [email], (err, row) => {
        if (err) {
            console.error(err.message);
            return res.status(403).send('User Not Found');
        }
        if (row) {
            const token = jwt.sign(
                { email: email, userId: row.id },
                process.env.AUTH_SECRET,
                { expiresIn: "24h" }
            );
            mailer.sendRecoveryEmail(token, email);
            return res.status(200).send('Password recovery email sent');
        } else {
            return res.status(403).send('Email not found');
        }
    });
});

app.post('/auth/recoverPassword', async (req, res) => {
    var { token, email, password } = req.body;
    if (!email || !token || !password) {
    	return res.status(403).json({error: 'Missing fields', success: false});
    }
    user = await verifyApiKey(token);
    password = await db.hashPassword(password);
    if (password)
    db.db.run('UPDATE users SET password = ? WHERE email = ?;', [password, email], (err) => {
        if (err) {
            return res.status(403).json({error: 'User Not Found', success: false});
        }
        return res.status(200).json({message: 'Password successfully recovered', success: true});
    });
});

app.post('/auth/removeAccount', async (req, res) => {
	try {
		const {jwt} = req.body;
		if (!jwt) {
			return res.status(400).json({error: "Error deleting user; Missing fields", success: false});
		}
		var user = await verifyApiKey(jwt);
		if (user) {
			db.db.run('DELETE FROM users WHERE username = ?', [await user.username], async (err) => {
				if (err) {
	    			console.error(err.message);
			        return res.status(400).json({error: "Error deleting user", success: false});
			    } else {
			    	db.db.run('DELETE FROM websites WHERE userID = ?', [await user.id]);
			    	db.db.run('DELETE FROM files WHERE userID = ?', [await user.id]);
			    	await fs.remove(path.join('websites/users', await user.username));
	    	    	return res.status(200).json({message: "User deleted", success: true});
		    	}
			});
		} else {
			return res.status(400).json({error: "Error deleting user; Missing user", success: false});
		}
	}
	catch (err) {
		console.log(err);
	}
});

const storage = multer.diskStorage({
    destination: async function (req, file, cb) {
        const { apiKey, dir } = req.body;
        try {
            // Sanitize dir to prevent directory traversal
            const sanitizedDir = path.normalize(dir || '').replace(/^(\.\.(\/|\\|$))+/, '');
            const username = await (await verifyApiKey(apiKey)).username;

            fs.ensureDirSync(path.join(__dirname, 'websites/users', await username, sanitizedDir));

            req.body.file = file;
            req.file = file;
            cb(null, path.join(__dirname, 'websites/users', await username, sanitizedDir));
        } catch (error) {
            req.res.status(401).json({ error: 'Invalid API key', success: false });
        }
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    },
});

const upload = multer({ 
    storage: storage,
    fileFilter: async function (req, file, cb) {
        try {
            const isValid = await verifyFile.checkFileName(file.originalname);
            if (isValid) {
                cb(null, true);
            } else {
                cb(new Error('Invalid file name'), false);
            }
        } catch (error) {
            cb(new Error('Error verifying file name'), false);
        }
    },
 });

app.post("/webring/join", async (req, res) => {
    const { email, name, url, msg } = req.body;
    try {
        mailer.sendPoyoringJoinRequestEmail(email, name, url, msg);
    } catch(err) {
        console.log(err);
        return res.status(400).json({ error: "Could not send email", success: false });
    }

    res.status(200).json({ success: true });
});

app.post('/file/upload', upload.single("file"), async (req, res) => {
    var { apiKey, dir, size } = req.body;
    var file = req.file;
    dir = dir || '';
    dir = dir.replace(/^(\.\.(\/|\\|$))+/, '');
    var user = await verifyApiKey(apiKey);
    if (file && file.originalname && file.size) {
        var fullPath = path.join(__dirname, 'websites/users', await user.username, dir || '');
        var filePath = path.join(fullPath, file.originalname);
        var resolvedPath = path.resolve(filePath);
        userDir = path.resolve(path.join(__dirname, 'websites/users', await user.username));

        if (!resolvedPath.startsWith(userDir)) {
            return res.status(400).json({ error: 'Invalid file path', success: false });
        }

        const fileSize = size;
        console.log(fileSize);
        var totalSize = await db.getTotalSizeByWebsiteName(await user.username) + fileSize;
        var fileID = await db.getFileIDByPath(filePath);

        if (await totalSize < (process.env.USER_MAX_SIZE || 524288000)) {
            const fileData = {
                fileName: file.originalname,
                fileLocation: path.join(dir, file.originalname),
                fileFullPath: fullPath,
                fileSize: fileSize,
                status: 'active',
                userID: await user.id // Assuming the decoded token contains userID
            };
            db.insertFileInfo(await fileID || null, fileData);
            if (await fileID) {
                const oldFileSize = (await fs.stat(filePath)).size;
                totalSize = totalSize - oldFileSize;
            }
            db.setTotalSizeByWebsiteName(await user.username, await totalSize);
            res.status(200).json({ message: 'File uploaded successfully', file: file });
            return;
        } else {
            res.status(400).json({ error: 'Not enough space for file', success: false });
            return;
        }
    } else {
        try {
            fs.unlink(path.join(__dirname, 'websites/users', await user.username, dir, file.originalname));
        } catch (error) {
            console.log(error);
        }
        res.status(400).json({ error: 'No file uploaded, could be due to missing fields or a suspicious name', success: false });
        return;
    }
});

app.post('/file/renameByPath', async (req, res) => {
    const { apiKey, file, newName } = req.body;

    try {
        const user = await verifyApiKey(apiKey);
        if (!user) {
            return res.status(401).json({ error: 'Invalid API key' });
        }

        const userDirectory = path.join('websites/users', user.username);

        // Ensure no directory traversal is possible by normalizing paths
        const sanitizedFilePath = path.normalize(path.join(userDirectory, file));
        const sanitizedNewFilePath = path.normalize(path.join(userDirectory, newName));

        // Check if the resolved paths are still within the intended directory
        if (!sanitizedFilePath.startsWith(userDirectory) || !sanitizedNewFilePath.startsWith(userDirectory)) {
            return res.status(400).json({ error: 'Invalid file path', success: false });
        }

        if (!await fs.pathExists(sanitizedFilePath)) {
            return res.status(404).json({ error: 'File not found', success: false });
        }

        // Update the database with the new file information
        db.insertFileInfo(
            db.getFileIDByPath(file),
            { fileLocation: sanitizedNewFilePath, fileName: newName, fileFullPath: sanitizedNewFilePath, userID: user.id }
        );

        // Rename the file
        await fs.rename(sanitizedFilePath, sanitizedNewFilePath);
        return res.status(200).json({ message: 'File renamed successfully', success: true });

    } catch (error) {
        console.error('Error renaming file:', error);
        return res.status(500).json({ error: 'Internal server error', success: false });
    }
});

app.post('/file/removeByPath', async (req, res) => {
    const { apiKey, file } = req.body;

    try {
        // Verify API key
        const user = jwt.verify(apiKey, process.env.AUTH_SECRET);

        const usr = await db.findUserById(user.id);
        const username = usr.username;

        console.log(username);
        var filePath = path.normalize(path.join(username, file));
        if (!user) {
            return res.status(401).json({ error: 'Invalid API key' });
        }
        var fileSize = (await fs.stat(path.join('websites/users', filePath))).size;
        var totalSize = await db.getTotalSizeByWebsiteName(username) - await fileSize;
        console.log(await db.getTotalSizeByWebsiteName(username), await fileSize);

        db.getFileIDByPath(file).then((res) => {
            db.removeFileByID(res);
        });

        db.setTotalSizeByWebsiteName(username, totalSize);
        if (!fs.existsSync(path.join('websites/users', filePath))) {
            return res.status(404).json({ error: 'File not found', success: false });
        }
        const stats = await fs.stat(path.join('websites/users', filePath));
        if (stats.isDirectory()) {
            await fs.remove(path.join('websites/users', filePath));
        } else {
            await fs.unlink(path.join('websites/users', filePath));
        }
        return res.status(200).json({ message: 'File removed successfully', success: true });

    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/file/', async (req, res) => {
    const { apiKey, dir } = req.query;
    var user = await verifyApiKey(apiKey);
    if (!user) {
        return res.status(401).json({ error: 'Invalid API key' });
    } else {
        var username = await user.username;
        if (await username) {
            var directory = path.join(__dirname, 'websites/users', username);
            if (dir) {
                directory = path.join(directory, dir);
            }
            directory = directory.replace(/^(\.\.(\/|\\|$))+/, '');
            try {
                if (!fs.existsSync(directory)) {
                    return res.status(404).json({ error: 'Directory not found' });
                }
                const files = await dirWalker(path.join(__dirname, 'websites/users', await username), directory);
                res.status(200).json({ files });
            } catch (error) {
                res.status(500).json({ error: 'Path not found: ' + error });
            }
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    }
});

app.post('/file/createDirectory', async (req, res) => {
    const { apiKey, dir, baseDir } = req.body;
    var user = await verifyApiKey(apiKey);
    if (!user) {
        return res.status(401).json({ error: 'Invalid API key' });
    } else {
        var username = await user.username;
        if (await username) {
            var directory = path.join(__dirname, 'websites/users', username, baseDir, dir);
            directory = directory.replace(/^(\.\.(\/|\\|$))+/, '');
            try {
                await fs.mkdir(directory, { recursive: true });
                res.status(200).json({ message: 'Directory created successfully', success: true });
            } catch (error) {
                res.status(500).json({ error: 'Error creating directory: ' + error });
            }
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    }
});

app.get('/file/retrieve', async (req, res) => {
    const { apiKey, file } = req.query;
    var user = await verifyApiKey(apiKey);
    if (!user) {
        return res.status(401).json({ error: 'Invalid API key' });
    } else {
        var username = await user.username;
        if (await username) {
            var filePath = path.join('websites/users', username, file);
            filePath = filePath.replace(/^(\.\.(\/|\\|$))+/, '');
            try {
                if (!fs.existsSync(filePath)) {
                    return res.status(404).json({ error: 'File not found' });
                }
                const fileContents = await fs.readFile(filePath, 'utf8');
                console.log(fileContents);
                res.status(200).json({ filename: path.basename(filePath), contents: fileContents });
            } catch (error) {
                res.status(500).json({ error: 'Path not found: ' + error });
            }
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    }
});

app.post("/settings/linkDomain", async (req, res) => {
	const { apiKey, domain } = req.body;
	if (!apiKey || !domain) {
		return res.status(403).json({error: "Missing fields", success: false});
	}
	const domainRegex = /^(?!.*https)(?!.*@)[a-zA-Z0-9-]{1,63}(\.[a-zA-Z]{2,})+$/;
	if (!domainRegex.test(domain)) {
		return res.status(403).json({error:"Invalid domain, make sure to not include 'HTTPS://'s or '@'s", success: false});
	}
	var user = await verifyApiKey(apiKey);
	if (!user) {
		return res.status(403).json({error: "Invalid user", success: false});
	}
	if (domain.includes(process.env.URL_SUFFIX) && !domain == user.username + process.env.URL_SUFFIX)  {
		return res.status(403).json({error: "DONT YOU TRY STEAL ANYONE ELSE'S USERNAME", success: false});
	}
	if (!checkDomain(domain)) {
		return res.status(403).json({error: "Reserved domain", success: false});
	}
	db.db.run('UPDATE websites SET domain = ?  WHERE userID = ?', [domain, user.id], async (err) => {
		if (!err) {
			if (process.env.DNS_GENERATE_SSL_CERT || false) {
				generateSSLCert(domain, user.email);
			}
			return res.status(200).json({message:"Domain updated!", success: true});
		} else {
			return res.status(403).json({error: "Domain is taken!", success: false});
		}
	});
});

app.post("/settings/resetDomain", async (req, res) => {
	const { apiKey } = req.body;
	if (!apiKey) {
		return res.status(403).json({error: "Missing fields", success: false});
	}
	const user = await verifyApiKey(apiKey);
	db.db.run('UPDATE websites SET domain = ?  WHERE userID = ?', [await (await user.username+"."+process.env.URL_SUFFIX), await user.id], async (err) => {
		if (!err) {
			return res.status(200).json({message:"Domain Restored!", success: true});
		} else {
			return res.status(500).json({error: "Internal Error", success: false});
		}
	});
});

app.get("/utils/getAllDomains", async (req, res) => {
	res.status(200).json(await (await db.getAllDomains()).concat(process.env.ADMIN_URL));
});

app.get("/utils/browseWebsites", async (req, res) => {
    var {sortby, order} = await req.query;
    res.status(200).json(await (await db.browseWebsites(sortby, order)));
});

app.get("/utils/getSiteInfo", async (req, res) => {
    const { apiKey } = await req.query;
    const user = await verifyApiKey(apiKey);

    if(!user) {
        return res.status(401).json({ error: 'Invalid API key' });
    } else {
        const siteID = await (await db.getWebsiteByUserId(user.id));
        res.status(200).json(await (await db.getSiteInfoByID(siteID.id)));
    }
});

app.post("/utils/updateInfo", async (req, res) => {
    const { apiKey, title, desc } = await req.body;
    const user = await verifyApiKey(apiKey);

    if(!user) {
    } else {
        const siteID = await (await db.getWebsiteByUserId(user.id));
        db.setSiteInfoByID(siteID.id, title, desc)
        res.status(200).json({ message: "Successfully changed info!" });
    }
});

async function generateSSLCert(domain, email) {
    if (!domain || !email) {
        return res.status(400).json({ error: 'Domain and email are required' });
    }
    try {
        // Check if the certificate already exists
        const certPath = `/etc/letsencrypt/live/${domain}`;
        if (await fs.pathExists(certPath)) {
            return { message: 'Certificate already exists', path: certPath, success: true };
        }

        // Run Certbot to generate the SSL certificate
        const cmd = `sudo certbot certonly --nginx -d ${domain} --non-interactive --agree-tos --email ${email}`;
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error generating certificate: ${stderr}`);
                return {message: 'Error generating certificate', success: false }
            }

            console.log(stdout);
            return {message: 'Certificate generated successfully', path: certPath, success: true };
        });
    } catch (error) {
        console.error(`Unexpected error: ${error.message}`);
    }
}
// Start the server
app.listen(port, () => {
    console.log(`PoyoWeb! API running at ${process.env.API_URL}:${port}`);
});
