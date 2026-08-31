from pydantic import BaseModel
from typing import List, Optional


class ChatMessageIn(BaseModel):
    user_id: str
    message: str


class ChatMessageOut(BaseModel):
    reply: str
    profile_updated: bool
    profile: Optional[dict] = None


class RecommendRequest(BaseModel):
    user_id: str
    query: str
    top_k: int = 5


class CourseOut(BaseModel):
    course_id: str
    title: str
    description: str
    level: str
    tags: List[str]
    estimated_hours: int


class RecommendResponse(BaseModel):
    matched_course: str
    similar_courses: List[CourseOut]


class PathGenerateRequest(BaseModel):
    user_id: str


class PathStep(BaseModel):
    order: int
    course_id: str
    title: str
    item_type: str = "course"
    reason: str
    milestone: str


class PathGenerateResponse(BaseModel):
    path_id: str
    steps: List[PathStep]
    skill_gaps: List[str] = []


class PathAdaptRequest(BaseModel):
    user_id: str
    path_id: str
    course_id: str          # the step they're giving feedback on
    feedback: str            # "struggled" | "too_easy" | "not_relevant" | free text


class ExplainRequest(BaseModel):
    user_id: str
    course_id: str


class ExplainResponse(BaseModel):
    explanation: str


class ProgressUpdateRequest(BaseModel):
    user_id: str
    course_id: str
    status: str  # "in_progress" | "completed"
    feedback: Optional[str] = None  # "struggled" | "too_easy" | freeform note
