from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import chat, recommend, path, explain, progress, assistant

app = FastAPI(title="Personalized Learning Path Recommender")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your frontend URL before deploying
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)
app.include_router(recommend.router)
app.include_router(path.router)
app.include_router(explain.router)
app.include_router(progress.router)
app.include_router(assistant.router)


@app.get("/health")
def health():
    return {"status": "ok"}
