from fastapi import APIRouter
from app.models import RecommendRequest, RecommendResponse, CourseOut
from app.engine.recommender import predict_course, top_related_courses
from app.engine.catalog import get_course

router = APIRouter(prefix="/recommend", tags=["recommend"])


@router.post("", response_model=RecommendResponse)
def recommend(payload: RecommendRequest):
    matched = predict_course(payload.query)
    related_titles = top_related_courses(payload.query, top_k=payload.top_k)

    courses = []
    for title in related_titles:
        meta = get_course(title)
        courses.append(
            CourseOut(
                course_id=meta["course_id"],
                title=meta["title"],
                description=meta["description"],
                level=meta["level"],
                tags=meta["tags"],
                estimated_hours=meta["estimated_hours"],
            )
        )

    return RecommendResponse(matched_course=matched, similar_courses=courses)
