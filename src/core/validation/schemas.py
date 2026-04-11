from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

class IntentDraft(BaseModel):
    """Phase 0: 意図のドラフト"""
    intent_summary: str = Field(..., description="ユーザーの意図を簡潔にまとめたもの")
    evaluation_axes: List[str] = Field(..., description="評価軸（評価の観点）のリスト")
    draft_comment: str = Field(..., description="ユーザーへ提示するドラフトコメント")

class AnalysisProposal(BaseModel):
    """Phase 1: 分析計画"""
    dependency_critical_nodes: List[str] = Field(..., description="解析すべき重要コンポーネント")
    questions_to_user: List[str] = Field(..., description="不確実性を排除するための質問リスト")

class RingiDocument(BaseModel):
    """Phase 4: 稟議書"""
    summary: str = Field(..., description="発生した事象の概要")
    impact_analysis: str = Field(..., description="影響範囲の分析")
    proposed_fix: str = Field(..., description="具体的な修正案")
    risk_assessment: str = Field(..., description="リスク評価")
