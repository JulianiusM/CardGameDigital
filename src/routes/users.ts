/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import express, {Request, Response} from 'express';
import * as userController from "../controller/userController";
import {isAuthenticated, isLoggedIn} from "../middleware/permissionMiddleware";
import {addNextQuery} from "../middleware/referrerUpdater";
import {asyncHandler} from '../modules/lib/asyncHandler';
import {ExpectedError} from "../modules/lib/errors";
import renderer from "../modules/renderer";
import settings from "../modules/settings";

const app = express.Router();
const root = "/users"

/* GET users listing. */
app.get('/', asyncHandler((req: Request, res: Response) => {
    res.redirect('/users/dashboard');
}));

// Registrierung von Benutzern
app.get('/register', addNextQuery("/users/register", root), asyncHandler((req: Request, res: Response) => {
    if (!settings.value.localLoginEnabled) return res.redirect("/users/oidc/login");
    renderer.render(res, 'users/register');  // Zeige das Registrierungsformular an
}));

app.post('/register', asyncHandler(async (req: Request, res: Response) => {
    if (!settings.value.localLoginEnabled) throw new ExpectedError('Login is not enabled!', 'error', 500);
    let next: string | undefined = undefined;
    if (typeof req.query.next === 'string') {
        next = req.query.next;
    }
    await userController.registerUser(req.body, next);
    renderer.renderInfo(res, 'Account successfully registered. Please activate it using the link sent to your email.');
}));

// Login-Funktionalität
app.get('/login', addNextQuery("/users/login", root), asyncHandler((req: Request, res: Response) => {
    if (!settings.value.localLoginEnabled) return res.redirect("/users/oidc/login");
    renderer.render(res, 'users/login');  // Zeige das Login-Formular an
}));

app.post('/login', asyncHandler(async (req: Request, res: Response) => {
    if (!settings.value.localLoginEnabled) throw new ExpectedError('Login is not enabled!', 'error', 500);
    await userController.loginUser(req.body, req.session);
    req.flash('success', 'Login successful');
    if (typeof req.query.next === 'string') {
        return res.redirect(req.query.next);
    }
    res.redirect('/users/dashboard');  // Weiterleitung nach dem Login
}));

// Logout
app.get('/logout', addNextQuery("/users/logout", root), asyncHandler(async (req: Request, res: Response) => {
    const redirect = await userController.logoutUserOidc(req.session);
    req.flash('success', 'Logout successful');
    if (typeof req.query.next === 'string') {
        return res.redirect(req.query.next);
    }
    res.redirect(redirect);
}));

// Passwort zurücksetzen: E-Mail mit Link senden
app.get('/forgot-password', asyncHandler((req: Request, res: Response) => {
    if (!settings.value.localLoginEnabled) throw new ExpectedError('Login is not enabled!', 'error', 500);
    renderer.render(res, 'users/forgot-password.pug');  // Zeige das Formular zum Zurücksetzen des Passworts
}));

app.post('/forgot-password', asyncHandler(async (req: Request, res: Response) => {
    if (!settings.value.localLoginEnabled) throw new ExpectedError('Login is not enabled!', 'error', 500);
    await userController.sendPasswordForgotMail(req.body.username);
    renderer.renderSuccess(res, 'A link has been sent to the email corresponding to this account (if present).')
}));

// Passwort zurücksetzen: Formular anzeigen
app.get('/reset-password/:token', asyncHandler(async (req: Request, res: Response) => {
    if (!settings.value.localLoginEnabled) throw new ExpectedError('Login is not enabled!', 'error', 500);
    const token = req.params.token as string;
    await userController.checkPasswordForgotToken(token);
    renderer.renderWithData(res, 'users/reset-password', {token});  // Zeige das Passwort-Reset-Formular an
}));

// Passwort zurücksetzen: Neues Passwort speichern
app.post('/reset-password/:token', asyncHandler(async (req: Request, res: Response) => {
    if (!settings.value.localLoginEnabled) throw new ExpectedError('Login is not enabled!', 'error', 500);
    await userController.resetPassword(req.params.token as string, req.body);
    renderer.renderSuccess(res, 'Your password has been successfully reset')
}));

// Aktivierungs-Link
app.get('/activate/:token', asyncHandler(async (req: Request, res: Response) => {
    if (!settings.value.localLoginEnabled) throw new ExpectedError('Login is not enabled!', 'error', 500);
    await userController.activateAccount(req.params.token as string);
    req.flash('success', 'Account successfully activated');
    if (typeof req.query.next === 'string') {
        return res.redirect(`/users/login?next=${req.query.next}`);
    }
    res.redirect('/users/login');
}));

app.get('/oidc/login', asyncHandler(async (req: Request, res: Response) => {
    if (!settings.value.oidcEnabled) throw new ExpectedError('OIDC provider is not enabled!', 'error', 500);
    const redirect = await userController.loginUserWithOidc(req.session);
    res.redirect(redirect);
}));

app.get('/oidc/callback', asyncHandler(async (req: Request, res: Response) => {
    if (!settings.value.oidcEnabled) throw new ExpectedError('OIDC provider is not enabled!', 'error', 500);
    await userController.loginUserWithOidcCallback(req);
    res.redirect('/users/dashboard'); // or wherever you want to land post-login
}));

// Dashboard nach dem Login
app.get('/dashboard', isLoggedIn, asyncHandler(async (req: Request, res: Response) => {
    renderer.renderWithData(res, 'users/dashboard', await userController.getEntityList(req.session.profile!));
}));

// Delete flows
app.get('/account/delete', isLoggedIn, asyncHandler(async (req: Request, res: Response) => {
    renderer.render(res, 'users/delete-account');
}));

app.post('/account/delete', isLoggedIn, asyncHandler(async (req: Request, res: Response) => {
    const nxt = await userController.deleteAccount(req.body, req.session);
    req.flash("success", "Account successfully deleted");
    res.redirect(nxt);
}));

app.get('/profile/delete', isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    renderer.render(res, 'users/profile/delete');
}));

app.post('/profile/delete', isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const msg = await userController.deactivateProfile(req.body, req.session);
    req.flash("success", msg);
    await userController.changeActiveProfile(req.session);
    res.redirect("/users/profile/manage");
}));

app.get('/profile/change/:id', isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    await userController.changeActiveProfile(req.session, req.params.id as string);
    req.flash("Profile changed!");
    res.redirect("/users/dashboard");
}));

app.get('/profile/migrate/request', isLoggedIn, asyncHandler(async (req: Request, res: Response) => {
    renderer.renderWithData(res, 'users/profile/migrate-token', {token: await userController.getMigrationToken(req.session!.profile!.id)});
}));

app.get('/profile/migrate/show', isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    renderer.render(res, 'users/profile/migrate-token-enter');
}))

app.post('/profile/migrate/show', isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    renderer.renderWithData(res, 'users/profile/migrate-validate', {profile: await userController.getProfileToMigrate(req.body.token)});
}))

app.post('/profile/migrate/execute', isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const msg = await userController.migrateProfile(req.session.auth!.user!.id, req.body.token);
    req.flash("success", msg);
    res.redirect("/users/profile/manage");
}));

app.get('/profile/create', isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    renderer.render(res, 'users/profile/create');
}))

app.post('/profile/create', isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    await userController.createProfile(req.body, req.session.auth!.user!.id);
    req.flash("success", "Profile created.");
    res.redirect("/users/profile/manage");
}))

app.get("/profile/manage", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    renderer.renderWithData(res, 'users/profile/manage', {profiles: await userController.getProfilesForUser(req.session.auth!.user!.id)});
}))

app.get("/profile", isLoggedIn, asyncHandler(async (req: Request, res: Response) => {
    renderer.render(res, 'users/profile/view');
}));

app.post("/profile", isLoggedIn, asyncHandler(async (req: Request, res: Response) => {
    const msg = await userController.updateProfile(req.body, req.session);
    req.flash("success", msg);
    res.redirect("/users/profile");
}));

export default app;
