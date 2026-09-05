import express from "express";
import { getHelpDocument, listHelpDocuments } from "../../application/helpService";
import { detectLocale } from "../../../../../packages/localization/messages";

const router = express.Router();
router.get("/", (request, response) =>
    response.json({
        documents: listHelpDocuments(detectLocale(request.get("accept-language"))),
    }),
);
router.get("/:slug", (request, response) =>
    response.json(
        getHelpDocument(detectLocale(request.get("accept-language")), request.params.slug),
    ),
);
export default router;
