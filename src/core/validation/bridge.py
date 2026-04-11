import instructor
from litellm import completion
from pydantic import create_model, BaseModel, Field
from typing import Any, Dict, Type, Optional, List
import logging

logger = logging.getLogger(__name__)

class InstructorBridge:
    """
    LLM 通信における厳格な型定義とバリデーションを担うブリッジ。
    Instructor と LiteLLM を統合し、動的なスキーマ生成をサポートする。
    """
    
    def __init__(self, model_name: str = "gemini/gemini-pro"):
        self.model_name = model_name
        # Instructor で client をパッチ (LiteLLM 経由)
        self.client = instructor.from_litellm(completion)

    def create_dynamic_model(self, name: str, schema: Dict[str, Any]) -> Type[BaseModel]:
        """
        JSON Schema から Pydantic モデルを動的に生成する。
        
        Args:
            name: モデル名
            schema: JSON Schema (dict)
            
        Returns:
            生成された Pydantic モデルクラス
        """
        fields = {}
        properties = schema.get("properties", {})
        required = schema.get("required", [])

        type_mapping = {
            "string": str,
            "integer": int,
            "number": float,
            "boolean": bool,
            "array": list,
            "object": dict
        }

        for field_name, prop in properties.items():
            json_type = prop.get("type", "string")
            python_type = type_mapping.get(json_type, Any)
            
            description = prop.get("description", "")
            
            # デフォルト値の設定
            if field_name in required:
                default_value = ... # 必須
            else:
                default_value = None
            
            fields[field_name] = (python_type, Field(default_value, description=description))

        return create_model(name, **fields, __base__=BaseModel)

    async def validate_and_extract(
        self, 
        prompt: str, 
        response_model: Type[BaseModel], 
        max_retries: int = 3
    ) -> Any:
        """
        LLM からの出力を特定のモデルに従って抽出し、バリデーションを行う。
        """
        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": "You are a precise data extractor. Output only valid JSON matching the schema."},
                    {"role": "user", "content": prompt}
                ],
                response_model=response_model,
                max_retries=max_retries
            )
            return response
        except Exception as e:
            logger.error(f"Instructor Validaton Error: {e}")
            raise

    async def ask_with_dynamic_schema(
        self, 
        prompt: str, 
        schema_name: str, 
        json_schema: Dict[str, Any]
    ) -> Any:
        """
        動的に生成したスキーマを用いて LLM に問い合わせる。
        """
        dynamic_model = self.create_dynamic_model(schema_name, json_schema)
        return await self.validate_and_extract(prompt, dynamic_model)
