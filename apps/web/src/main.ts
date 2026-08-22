import { mount } from "svelte";
import App from "./App.svelte";
import { locale, messages } from "./i18n";
import "./style.css";
import "./experience.css";

document.documentElement.lang = locale;
document.title = messages.documentTitle;
mount(App, { target: document.getElementById("app")! });
